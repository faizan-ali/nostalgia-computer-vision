import type { BoundingBox, Color, EnhancedPhoto } from '@/lib/types'

/**
 * Calculates similarity between two photos based on their web entities.
 * Uses Jaccard similarity coefficient on entity IDs.
 * @param photo1 - First photo to compare
 * @param photo2 - Second photo to compare
 * @returns Similarity score between 0 and 1
 */
export const calculateWebEntitySimilarity = (photo1: EnhancedPhoto, photo2: EnhancedPhoto): number => {
  const entities1 = photo1.analysis.webDetection.webEntities || []
  const entities2 = photo2.analysis.webDetection.webEntities || []

  if (entities1.length === 0 || entities2.length === 0) return 0

  const entityIds1 = new Set(entities1.map(e => e.entityId).filter((id): id is string => id !== undefined))
  const entityIds2 = new Set(entities2.map(e => e.entityId).filter((id): id is string => id !== undefined))

  if (entityIds1.size === 0 || entityIds2.size === 0) return 0

  const intersection = new Set([...entityIds1].filter(x => entityIds2.has(x)))
  const union = new Set([...entityIds1, ...entityIds2])

  return intersection.size / union.size
}

/**
 * Calculates visual similarity between two photos based on colors and layout.
 * Combines color similarity and spatial arrangement of elements.
 * @param photo1 - First photo to compare
 * @param photo2 - Second photo to compare
 * @returns Similarity score between 0 and 1
 */
export const calculateVisualFeatureSimilarity = (photo1: EnhancedPhoto, photo2: EnhancedPhoto): number => {
  const getVisualElements = (photo: EnhancedPhoto): BoundingBox[] => {
    return [...photo.analysis.faces.map(face => face.boundingBox), ...photo.analysis.landmarks.map(landmark => landmark.boundingBox)]
  }

  const colorSimilarity = calculateColorSimilarity(
    photo1.analysis.imageProperties.dominantColors,
    photo2.analysis.imageProperties.dominantColors
  )

  const createLayoutFingerprint = (elements: BoundingBox[]): string => {
    return elements
      .map(box => `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`)
      .sort()
      .join('|')
  }

  // Convert BoundingBox arrays to layout fingerprints before comparison
  const layout1 = createLayoutFingerprint(getVisualElements(photo1))
  const layout2 = createLayoutFingerprint(getVisualElements(photo2))
  const layoutSimilarity = calculateLayoutSimilarity(layout1, layout2)

  return colorSimilarity * 0.6 + layoutSimilarity * 0.4
}

export const calculateColorSimilarity = (colors1: Color[], colors2: Color[]): number => {
  const calculateColorDistance = (color1: Color, color2: Color): number => {
    return Math.sqrt(
      (color1.color.red - color2.color.red) ** 2 +
        (color1.color.green - color2.color.green) ** 2 +
        (color1.color.blue - color2.color.blue) ** 2
    )
  }
  if (colors1.length === 0 || colors2.length === 0) return 0

  let totalSimilarity = 0
  let comparisons = 0

  colors1.forEach(color1 => {
    colors2.forEach(color2 => {
      const similarity = 1 - calculateColorDistance(color1, color2) / 441.67 // Max possible distance
      totalSimilarity += similarity * (color1.pixelFraction * color2.pixelFraction)
      comparisons++
    })
  })

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

export const calculateLayoutSimilarity = (layout1: string, layout2: string): number => {
  const elements1 = layout1.split('|')
  const elements2 = layout2.split('|')

  if (elements1.length === 0 || elements2.length === 0) return 0

  const maxLength = Math.max(elements1.length, elements2.length)
  const matchingElements = elements1.filter(element => elements2.includes(element))

  return matchingElements.length / maxLength
}
