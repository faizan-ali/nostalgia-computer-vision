import { convertBoundingPoly, convertLikelihood } from '@/lib/highlighter/vision-api'
import type { BoundingBox } from '@/lib/types'
import type { protos } from '@google-cloud/vision'
import { google } from '@google-cloud/vision/build/protos/protos'
import AnnotateImageResponse = google.cloud.vision.v1.AnnotateImageResponse

/**
 * Evaluates image blur using face detection and edge analysis.
 * Combines face blur detection with overall image sharpness estimation.
 * @param result - Annotation response from Google Vision API
 * @returns Blur score between 0 and 1 (1 = sharp, 0 = blurry)
 */
export const evaluateBlur = (result: protos.google.cloud.vision.v1.IAnnotateImageResponse): number => {
  const blurScores: number[] = []

  // Check face blur if faces are present
  if (result.faceAnnotations && result.faceAnnotations.length > 0) {
    const faceBlurScores = result.faceAnnotations.map(face => 1 - convertLikelihood(face.blurredLikelihood))
    blurScores.push(...faceBlurScores)
  }

  // Check edge detection through color analysis
  if (result.imagePropertiesAnnotation?.dominantColors?.colors) {
    const { colors } = result.imagePropertiesAnnotation.dominantColors
    let edgeStrength = 0

    for (let i = 0; i < colors.length - 1; i++) {
      const color1 = colors[i].color || {}
      const color2 = colors[i + 1].color || {}

      const contrast = Math.sqrt(
        ((color1.red || 0) - (color2.red || 0)) ** 2 +
          ((color1.green || 0) - (color2.green || 0)) ** 2 +
          ((color1.blue || 0) - (color2.blue || 0)) ** 2
      )

      edgeStrength += contrast
    }

    const normalizedEdgeStrength = Math.min(edgeStrength / (255 * Math.sqrt(3) * (colors.length - 1)), 1)
    blurScores.push(normalizedEdgeStrength)
  }

  // If no scores were calculated, return middle value
  if (blurScores.length === 0) return 0.5

  // Weight face blur more heavily if present
  const hasfaces = result.faceAnnotations && result.faceAnnotations.length > 0
  if (hasfaces) {
    const faceBlurAverage = blurScores.slice(0, -1).reduce((sum, score) => sum + score, 0) / (blurScores.length - 1)
    const edgeScore = blurScores[blurScores.length - 1]
    return faceBlurAverage * 0.7 + edgeScore * 0.3
  }

  return blurScores.reduce((sum, score) => sum + score, 0) / blurScores.length
}

/**
 * Evaluates image exposure using color analysis.
 * Optimal exposure is considered to be middle gray (0.5).
 * @param result - Annotation response from Google Vision API
 * @returns Exposure score between 0 and 1
 */
export const evaluateExposure = (result: protos.google.cloud.vision.v1.IAnnotateImageResponse): number => {
  if (!result.imagePropertiesAnnotation?.dominantColors?.colors) return 0.5

  const { colors } = result.imagePropertiesAnnotation.dominantColors
  let totalBrightness = 0
  let totalWeight = 0

  colors.forEach(color => {
    const rgb = color.color || {}
    const brightness = ((rgb.red || 0) + (rgb.green || 0) + (rgb.blue || 0)) / (3 * 255)
    const weight = color.pixelFraction || 0

    totalBrightness += brightness * weight
    totalWeight += weight
  })

  const averageBrightness = totalWeight > 0 ? totalBrightness / totalWeight : 0.5

  // Score peaks at 0.5 (middle gray) and falls off towards extremes
  return 1 - Math.abs(averageBrightness - 0.5) * 2
}

/**
 * Evaluates image noise by analyzing color transitions and consistency.
 * @param result - Annotation response from Google Vision API
 * @returns Noise score between 0 and 1 (1 = clean, 0 = noisy)
 */
export const evaluateNoise = (result: protos.google.cloud.vision.v1.IAnnotateImageResponse): number => {
  if (!result.imagePropertiesAnnotation?.dominantColors?.colors) return 0.5

  const { colors } = result.imagePropertiesAnnotation.dominantColors
  if (colors.length < 2) return 0.5

  let noiseScore = 1
  let totalWeight = 0

  // Compare adjacent colors for smooth transitions
  for (let i = 0; i < colors.length - 1; i++) {
    const color1 = colors[i].color || {}
    const color2 = colors[i + 1].color || {}

    const colorDifference =
      Math.sqrt(
        ((color1.red || 0) - (color2.red || 0)) ** 2 +
          ((color1.green || 0) - (color2.green || 0)) ** 2 +
          ((color1.blue || 0) - (color2.blue || 0)) ** 2
      ) /
      (255 * Math.sqrt(3))

    const weight = (colors[i].pixelFraction || 0) + (colors[i + 1].pixelFraction || 0)
    noiseScore -= colorDifference * weight
    totalWeight += weight
  }

  return Math.max(0, Math.min(1, noiseScore / (totalWeight || 1)))
}

/**
 * Evaluates composition using rule of thirds compliance, subject prominence,
 * and visual balance analysis.
 * @param result - Annotation response from Google Vision API
 * @returns Composition score between 0 and 1
 */
export const evaluateComposition = (result: protos.google.cloud.vision.v1.IAnnotateImageResponse): number => {
  let compositionScore = 0
  let scoreComponents = 0

  const thirdsScore = evaluateRuleOfThirds(result)
  if (thirdsScore !== null) {
    compositionScore += thirdsScore * 0.4
    scoreComponents++
  }

  const prominenceScore = evaluateSubjectProminence(result)
  if (prominenceScore !== null) {
    compositionScore += prominenceScore * 0.3
    scoreComponents++
  }

  const balanceScore = evaluateVisualBalance(result)
  if (balanceScore !== null) {
    compositionScore += balanceScore * 0.3
    scoreComponents++
  }

  return scoreComponents > 0 ? compositionScore / scoreComponents : 0.5
}

/**
 * Evaluates how well the image follows the rule of thirds.
 * Analyzes position of detected faces, landmarks, and objects.
 * @param result - Annotation response from Google Vision API
 * @returns Rule of thirds score between 0 and 1, or null if no subjects detected
 */
const evaluateRuleOfThirds = (result: AnnotateImageResponse): number | null => {
  const subjects = [
    ...(result.faceAnnotations || []).map(face => convertBoundingPoly(face.boundingPoly)),
    ...(result.landmarkAnnotations || []).map(landmark => convertBoundingPoly(landmark.boundingPoly)),
    ...(result.localizedObjectAnnotations || []).map(object => convertBoundingPoly(object.boundingPoly))
  ].filter((box): box is BoundingBox => box !== null)

  if (subjects.length === 0) return null

  // Define thirds grid lines (normalized to 0-1)
  const thirdLines = {
    vertical: [0.33, 0.67],
    horizontal: [0.33, 0.67]
  }

  // Calculate score for each subject
  const scores = subjects.map(subject => {
    // Get center point of subject
    const centerX = subject.left + subject.width / 2
    const centerY = subject.top + subject.height / 2

    // Find closest thirds lines
    const distanceToVertical = Math.min(...thirdLines.vertical.map(third => Math.abs(third - centerX)))
    const distanceToHorizontal = Math.min(...thirdLines.horizontal.map(third => Math.abs(third - centerY)))

    // Score based on distance to thirds lines (closer is better)
    return 1 - Math.min((distanceToVertical + distanceToHorizontal) / 2, 1)
  })

  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

/**
 * Evaluates how prominently subjects are positioned in the image.
 * Considers subject size and position relative to image center.
 * @param result - Annotation response from Google Vision API
 * @returns Prominence score between 0 and 1, or null if no subjects detected
 */
const evaluateSubjectProminence = (result: AnnotateImageResponse): number | null => {
  const subjects = [
    ...(result.faceAnnotations || []).map(face => convertBoundingPoly(face.boundingPoly)),
    ...(result.landmarkAnnotations || []).map(landmark => convertBoundingPoly(landmark.boundingPoly)),
    ...(result.localizedObjectAnnotations || []).map(object => convertBoundingPoly(object.boundingPoly))
  ].filter((box): box is BoundingBox => box !== null)

  if (subjects.length === 0) return null

  // Calculate the total image area (normalized to 1)
  const imageArea = 1

  // Calculate prominence score based on subject size and position
  const prominenceScores = subjects.map(subject => {
    // Calculate subject area
    const subjectArea = subject.width * subject.height
    const areaScore = Math.min(subjectArea / (imageArea * 0.5), 1) // Ideal subject size is 20-50% of image

    // Calculate distance from center
    const centerX = subject.left + subject.width / 2
    const centerY = subject.top + subject.height / 2
    const distanceFromCenter = Math.sqrt((centerX - 0.5) ** 2 + (centerY - 0.5) ** 2)
    const positionScore = 1 - Math.min(distanceFromCenter / 0.5, 1)

    return areaScore * 0.6 + positionScore * 0.4
  })

  return prominenceScores.reduce((sum, score) => sum + score, 0) / prominenceScores.length
}

/**
 * Evaluates visual balance by analyzing distribution of visual weight
 * across the image using color information.
 * @param result - Annotation response from Google Vision API
 * @returns Balance score between 0 and 1, or null if no color information
 */
const evaluateVisualBalance = (result: AnnotateImageResponse): number | null => {
  const dominantColors = result.imagePropertiesAnnotation?.dominantColors?.colors
  if (!dominantColors || dominantColors.length === 0) return null

  let leftWeight = 0
  let rightWeight = 0
  let topWeight = 0
  let bottomWeight = 0

  // Assume colors are distributed across the image and calculate balance
  dominantColors.forEach(color => {
    const weight =
      ((color.pixelFraction || 0) * ((color.color?.red || 0) + (color.color?.green || 0) + (color.color?.blue || 0))) / (3 * 255)

    // Distribute weight across quadrants
    leftWeight += weight * 0.5
    rightWeight += weight * 0.5
    topWeight += weight * 0.5
    bottomWeight += weight * 0.5
  })

  // Calculate balance scores
  const horizontalBalance = 1 - Math.abs(leftWeight - rightWeight)
  const verticalBalance = 1 - Math.abs(topWeight - bottomWeight)

  return horizontalBalance * 0.5 + verticalBalance * 0.5
}
