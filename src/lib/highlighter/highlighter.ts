import { calculateDistance } from '@/lib/distance'
import { areColorsSimilar } from '@/lib/highlighter/colors'
import { calculateBrightness, calculateContrast, calculateSharpness } from '@/lib/highlighter/photo'
import {
  calculateLayoutSimilarity,
  calculateVisualFeatureSimilarity,
  calculateWebEntitySimilarity
} from '@/lib/highlighter/photo-meta-similarity'
import { evaluateBlur, evaluateComposition, evaluateExposure, evaluateNoise } from '@/lib/highlighter/photo-quality'
import { convertBoundingPoly, convertLikelihood } from '@/lib/highlighter/vision-api'
import type {
  BatchProcessingResult,
  EnhancedPhoto,
  FaceAnalysis,
  GoogleImageProperties,
  GoogleWebDetection,
  HighlightOptions,
  ImageProperties,
  Label,
  LabelFrequencies,
  Landmark,
  Photo,
  PhotoAnalysis,
  QualityMetrics
} from '@/lib/types'
import { ImageAnnotatorClient } from '@google-cloud/vision'
import type { JWTInput } from 'google-auth-library/build/src/auth/credentials'

/**
 * Main class for analyzing and selecting highlight photos using Google Cloud Vision API.
 * Provides comprehensive photo analysis including quality assessment, similarity detection,
 * and intelligent selection of the best and most diverse photos from a collection.
 */
export class GoogleVisionHighlightSelector {
  private readonly visionClient: ImageAnnotatorClient
  private oauth2Client: OAuth2Client

  private photos: EnhancedPhoto[]
  private labelFrequencies: LabelFrequencies
  private readonly defaultWeights: Required<NonNullable<HighlightOptions['weights']>>

  constructor(credentials: JWTInput) {
    this.visionClient = new ImageAnnotatorClient({ credentials })
    this.photos = []
    this.labelFrequencies = {
      individual: new Map(),
      combinations: new Map()
    }
    this.defaultWeights = {
      quality: 0.25,
      interest: 0.2,
      emotion: 0.15,
      uniqueness: 0.15,
      relevance: 0.15,
      temporal: 0.1
    }
  }

  /**
   * Processes and adds new photos to the selection pool.
   * Analyzes each photo using Google Vision API and updates label frequencies.
   * @param photos - Array of photos to analyze and add to the selection pool
   * @returns Object containing successfully processed photos and any failures
   */
  public async addPhotos(photos: Photo[]): Promise<BatchProcessingResult> {
    const results: BatchProcessingResult = {
      success: [],
      failed: []
    }

    for (const photo of photos) {
      console.log('Processing photo:', photo.url)
      try {
        const enhancedPhoto = await this.analyzePhoto(photo)
        this.photos.push(enhancedPhoto)
        results.success.push(enhancedPhoto)
        this.updateLabelFrequencies(enhancedPhoto.analysis.labels)
      } catch (error) {
        results.failed.push({
          photo,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }
    }

    return results
  }

  /**
   * Performs comprehensive analysis of a single photo using Google Vision API.
   * Includes face detection, label detection, landmark detection, and image property analysis.
   * @param photo - Photo to analyze
   * @returns Enhanced photo object with analysis results
   */
  private async analyzePhoto(photo: Photo): Promise<EnhancedPhoto> {
    const [result] = await this.visionClient.annotateImage({
      image: { content: photo.buffer },
      features: [
        { type: 'FACE_DETECTION', maxResults: 50 },
        { type: 'LABEL_DETECTION', maxResults: 50 },
        { type: 'LANDMARK_DETECTION', maxResults: 20 },
        { type: 'IMAGE_PROPERTIES' },
        { type: 'WEB_DETECTION' },
        { type: 'SAFE_SEARCH_DETECTION' }
      ]
    })

    console.log('Photo analysis result:', result)

    if (!result) {
      throw new Error('Failed to analyze photo: No result returned')
    }

    const analysis: PhotoAnalysis = {
      // Processes face annotations from Google Vision API into standardized format.
      // Includes emotion detection, blur detection, and face landmark information.
      faces: (result.faceAnnotations || []).map(face => ({
        boundingBox: convertBoundingPoly(face.boundingPoly),
        landmarks: (face.landmarks || []).map(landmark => ({
          type: landmark.type?.toString() || '',
          position: {
            x: landmark.position?.x || 0,
            y: landmark.position?.y || 0,
            z: landmark.position?.z || 0
          }
        })),
        emotions: {
          joy: convertLikelihood(face.joyLikelihood),
          sorrow: convertLikelihood(face.sorrowLikelihood),
          anger: convertLikelihood(face.angerLikelihood),
          surprise: convertLikelihood(face.surpriseLikelihood)
        },
        confidence: face.detectionConfidence || 0,
        blurred: convertLikelihood(face.blurredLikelihood) > 0.5,
        headwear: convertLikelihood(face.headwearLikelihood) > 0.5
      })),
      labels: (result.labelAnnotations || []).map(label => ({
        description: label.description || '',
        score: label.score || 0,
        topicality: label.topicality || 0
      })),
      landmarks: (result.landmarkAnnotations || []).map(landmark => ({
        name: landmark.description || '',
        score: landmark.score || 0,
        boundingBox: convertBoundingPoly(landmark.boundingPoly),
        locations: landmark.locations?.map(location => ({
          latitude: location.latLng?.latitude || 0,
          longitude: location.latLng?.longitude || 0
        }))
      })),
      imageProperties: this.processImageProperties(result.imagePropertiesAnnotation),
      webDetection: result.webDetection || {},
      safeSearch: result.safeSearchAnnotation || {},
      // Calculates comprehensive quality metrics for a photo.
      // Includes blur, exposure, noise, and composition analysis.
      quality: {
        blurScore: evaluateBlur(result),
        exposureScore: evaluateExposure(result),
        noiseScore: evaluateNoise(result),
        compositionScore: evaluateComposition(result)
      },
      clustering: this.assignPhotoClusters(photo)
    }

    return {
      ...photo,
      analysis
    }
  }

  /**
   * Processes image property information from Google Vision API.
   * Includes color analysis and various quality metrics.
   * @param properties - Image properties from Google Vision API
   * @returns Processed image properties
   */
  private processImageProperties(properties: GoogleImageProperties | null | undefined): ImageProperties {
    if (!properties?.dominantColors?.colors) {
      return {
        dominantColors: [],
        brightness: 0,
        contrast: 0,
        sharpness: 0
      }
    }

    return {
      dominantColors: properties.dominantColors.colors.map(color => ({
        color: {
          red: color.color?.red || 0,
          green: color.color?.green || 0,
          blue: color.color?.blue || 0
        },
        score: color.score || 0,
        pixelFraction: color.pixelFraction || 0
      })),
      brightness: calculateBrightness(properties),
      contrast: calculateContrast(properties),
      sharpness: calculateSharpness(properties)
    }
  }

  /**
   * Selects the best photos from the processed pool based on provided options.
   * Ensures temporal diversity and quality while avoiding similar photos.
   * @param options - Configuration for highlight selection including limits and preferences
   * @returns Array of selected highlight photos
   */
  public async selectHighlights(options: HighlightOptions): Promise<EnhancedPhoto[]> {
    /**
     * Calculates comprehensive quality metrics for a photo.
     * Includes blur, exposure, noise, and composition analysis.
     */
    const calculateQualityScore = (quality: QualityMetrics): number => {
      const weights = {
        blur: 0.35,
        exposure: 0.25,
        noise: 0.2,
        composition: 0.2
      }

      return (
        quality.blurScore * weights.blur +
        quality.exposureScore * weights.exposure +
        quality.noiseScore * weights.noise +
        quality.compositionScore * weights.composition
      )
    }

    const calculateInterestScore = (analysis: PhotoAnalysis): number => {
      const calculateFaceInterestScore = (faces: FaceAnalysis[]): number => {
        if (faces.length === 0) return 0

        const faceScores = faces.map(face => {
          const emotionScore = Math.max(
            face.emotions.joy,
            face.emotions.surprise,
            face.emotions.sorrow * 0.5,
            face.emotions.anger * 0.5
          )

          const qualityScore = face.confidence * (face.blurred ? 0.5 : 1)

          return emotionScore * 0.6 + qualityScore * 0.4
        })

        // Favor photos with multiple faces but don't overweight them
        const multipleFaceFactor = Math.min(faces.length / 3, 1)
        const averageScore = faceScores.reduce((sum, score) => sum + score, 0) / faceScores.length

        return averageScore * (1 + multipleFaceFactor * 0.2)
      }

      const calculateLandmarkInterestScore = (landmarks: Landmark[]): number => {
        if (landmarks.length === 0) return 0

        return landmarks.reduce((score, landmark) => {
          const confidence = landmark.score
          const hasLocation = landmark.locations && landmark.locations.length > 0
          return Math.max(score, confidence * (hasLocation ? 1.2 : 1))
        }, 0)
      }

      const calculateWebInterestScore = (webDetection: GoogleWebDetection): number => {
        if (!webDetection.webEntities?.length) return 0

        const entityScores = webDetection.webEntities.map(entity => ({
          score: entity.score || 0,
          hasDescription: Boolean(entity.description)
        }))

        const averageScore =
          entityScores.reduce((sum, entity) => sum + entity.score * (entity.hasDescription ? 1.2 : 1), 0) / entityScores.length

        // Normalize to 0-1 range
        return Math.min(averageScore / 0.8, 1)
      }

      const scores = {
        faces: calculateFaceInterestScore(analysis.faces),
        landmarks: calculateLandmarkInterestScore(analysis.landmarks),
        labels: calculateLabelInterestScore(analysis.labels),
        web: calculateWebInterestScore(analysis.webDetection)
      }

      const weights = {
        faces: 0.35,
        landmarks: 0.25,
        labels: 0.25,
        web: 0.15
      }

      return Object.entries(weights).reduce((total, [key, weight]) => total + scores[key as keyof typeof scores] * weight, 0)
    }

    const calculateLabelInterestScore = (labels: Label[]): number => {
      const interestingCategories = {
        events: ['wedding', 'party', 'celebration', 'ceremony', 'festival'],
        activities: ['sport', 'dance', 'performance', 'game', 'adventure'],
        nature: ['sunset', 'beach', 'mountain', 'landscape', 'wildlife'],
        emotions: ['smile', 'happy', 'joy', 'laugh', 'excited'],
        landmarks: ['monument', 'building', 'architecture', 'statue', 'tower']
      }

      const categoryScores = new Map<string, number>()

      labels.forEach(label => {
        for (const [category, keywords] of Object.entries(interestingCategories)) {
          if (keywords.some(keyword => label.description.toLowerCase().includes(keyword))) {
            const currentScore = categoryScores.get(category) || 0
            categoryScores.set(category, Math.max(currentScore, label.score))
          }
        }
      })

      if (categoryScores.size === 0) return 0.4 // Base score for photos with no interesting categories

      const averageCategoryScore = Array.from(categoryScores.values()).reduce((sum, score) => sum + score, 0) / categoryScores.size

      // Bonus for multiple interesting categories
      const diversityBonus = Math.min((categoryScores.size - 1) * 0.1, 0.3)

      return Math.min(averageCategoryScore + diversityBonus, 1)
    }

    const calculateEmotionScore = (faces: FaceAnalysis[]): number => {
      if (faces.length === 0) return 0.5 // Neutral score for photos without faces

      const emotionScores = faces.map(face => {
        const emotions = face.emotions
        return {
          positive: emotions.joy + emotions.surprise * 0.7,
          negative: emotions.sorrow + emotions.anger,
          confidence: face.confidence
        }
      })

      const weightedScores = emotionScores.map(score => ({
        positiveScore: score.positive * score.confidence,
        negativeScore: score.negative * score.confidence
      }))

      const totalPositive = weightedScores.reduce((sum, score) => sum + score.positiveScore, 0)
      const totalNegative = weightedScores.reduce((sum, score) => sum + score.negativeScore, 0)
      const totalConfidence = emotionScores.reduce((sum, score) => sum + score.confidence, 0)

      if (totalConfidence === 0) return 0.5

      // Favor positive emotions but don't completely discount negative ones
      const normalizedPositive = totalPositive / totalConfidence
      const normalizedNegative = totalNegative / totalConfidence

      return Math.min(normalizedPositive * 0.8 + (1 - normalizedNegative) * 0.2, 1)
    }

    const calculateUniquenessScore = (photo: EnhancedPhoto): number => {
      const labelUniqueness = this.calculateLabelUniqueness(photo.analysis.labels)
      const visualUniqueness = this.calculateVisualUniqueness(photo.analysis.webDetection)
      const compositionUniqueness = this.calculateCompositionUniqueness(photo)

      return labelUniqueness * 0.4 + visualUniqueness * 0.4 + compositionUniqueness * 0.2
    }

    const calculateRelevanceScore = (photo: EnhancedPhoto, preferredTypes: string[]): number => {
      if (preferredTypes.length === 0) return 1

      const relevantLabels = photo.analysis.labels.filter(label =>
        preferredTypes.some(type => label.description.toLowerCase().includes(type.toLowerCase()))
      )

      if (relevantLabels.length === 0) return 0

      return relevantLabels.reduce((score, label) => score + label.score, 0) / relevantLabels.length
    }

    const calculateTemporalScore = (dateTime: Date, timeRange: HighlightOptions['timeRange']): number => {
      const { start, end } = timeRange
      const totalRange = end.getTime() - start.getTime()
      const position = dateTime.getTime() - start.getTime()

      // Favor photos from the middle of the time range
      const normalizedPosition = position / totalRange
      const distanceFromMiddle = Math.abs(0.5 - normalizedPosition)

      return 1 - distanceFromMiddle
    }
    // Calculate scores for all photos
    const scoredPhotos = await Promise.all(
      this.photos.map(async photo => {
        const scores = {
          quality: calculateQualityScore(photo.analysis.quality),
          interest: calculateInterestScore(photo.analysis),
          emotion: calculateEmotionScore(photo.analysis.faces),
          uniqueness: calculateUniquenessScore(photo),
          relevance: calculateRelevanceScore(photo, options.preferredTypes),
          temporal: calculateTemporalScore(photo.dateTime, options.timeRange),
          final: 0
        }

        // Calculate final weighted score
        const weights = { ...this.defaultWeights, ...options.weights }
        scores.final = Object.entries(weights).reduce((total, [key, weight]) => total + scores[key as keyof typeof scores] * weight, 0)
        return { ...photo, scores }
      })
    )

    // Group similar photos
    const groups = this.groupSimilarPhotos(scoredPhotos)

    // Select best photos while maintaining temporal diversity
    return this.selectDiverseHighlights(groups, options)
  }

  private calculateLabelUniqueness(labels: Label[]): number {
    if (labels.length === 0) return 0

    // Calculate individual label uniqueness
    const individualScores = labels.map(label => {
      const frequency = this.labelFrequencies.individual.get(label.description) || 1
      const uniqueness = 1 / Math.sqrt(frequency) // Square root to soften the impact of frequency
      return uniqueness * label.score
    })

    // Calculate combination uniqueness
    const combinationScores: number[] = []
    for (let i = 0; i < labels.length - 1; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const combo = [labels[i].description, labels[j].description].sort().join('|')
        const frequency = this.labelFrequencies.combinations.get(combo) || 1
        const uniqueness = 1 / Math.sqrt(frequency)
        combinationScores.push(uniqueness * Math.min(labels[i].score, labels[j].score))
      }
    }

    const avgIndividualScore = individualScores.reduce((sum, score) => sum + score, 0) / individualScores.length
    const avgCombinationScore =
      combinationScores.length > 0 ? combinationScores.reduce((sum, score) => sum + score, 0) / combinationScores.length : 0

    return avgIndividualScore * 0.4 + avgCombinationScore * 0.6
  }

  private calculateVisualUniqueness(webDetection: GoogleWebDetection): number {
    if (!webDetection.visuallySimilarImages?.length) return 1

    // Fewer similar images means more unique
    const similarityScore = Math.max(0, 1 - webDetection.visuallySimilarImages.length / 10)

    // Check partial matching if available
    const partialMatchScore = webDetection.partialMatchingImages?.length
      ? Math.max(0, 1 - webDetection.partialMatchingImages.length / 5)
      : 1

    return similarityScore * 0.7 + partialMatchScore * 0.3
  }

  private calculateCompositionUniqueness(photo: EnhancedPhoto): number {
    const { imageProperties, faces, landmarks } = photo.analysis

    // Calculate color uniqueness
    const colorUniqueness = this.calculateColorUniqueness(imageProperties)

    // Calculate layout uniqueness
    const layoutUniqueness = this.calculateLayoutUniqueness(faces, landmarks)

    return colorUniqueness * 0.5 + layoutUniqueness * 0.5
  }

  private calculateColorUniqueness(properties: ImageProperties): number {
    const colors = properties.dominantColors
    if (colors.length === 0) return 0

    // Calculate color distribution uniqueness
    const colorDistribution = colors.map(color => ({
      rgb: `${color.color.red},${color.color.green},${color.color.blue}`,
      fraction: color.pixelFraction
    }))

    let uniquenessScore = 0
    colorDistribution.forEach(color => {
      // Compare with other photos' color distributions
      let similarityCount = 0
      this.photos.forEach(otherPhoto => {
        if (
          otherPhoto.analysis.imageProperties.dominantColors.some(otherColor =>
            areColorsSimilar(color.rgb, `${otherColor.color.red},${otherColor.color.green},${otherColor.color.blue}`)
          )
        ) {
          similarityCount++
        }
      })

      uniquenessScore += (1 - similarityCount / this.photos.length) * color.fraction
    })

    return uniquenessScore / colorDistribution.length
  }

  private calculateLayoutUniqueness(faces: FaceAnalysis[], landmarks: Landmark[]): number {
    const elements = [...faces.map(face => face.boundingBox), ...landmarks.map(landmark => landmark.boundingBox)]

    if (elements.length === 0) return 0.5

    // Create a simple layout fingerprint
    const layoutFingerprint = elements
      .map(box => `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`)
      .sort()
      .join('|')

    // Compare with other photos
    let similarLayoutCount = 0
    this.photos.forEach(otherPhoto => {
      const otherElements = [
        ...otherPhoto.analysis.faces.map(face => face.boundingBox),
        ...otherPhoto.analysis.landmarks.map(landmark => landmark.boundingBox)
      ]

      const otherFingerprint = otherElements
        .map(box => `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`)
        .sort()
        .join('|')

      if (calculateLayoutSimilarity(layoutFingerprint, otherFingerprint) > 0.8) {
        similarLayoutCount++
      }
    })

    return 1 - similarLayoutCount / this.photos.length
  }

  private assignPhotoClusters(photo: Photo): PhotoAnalysis['clustering'] {
    const hour = photo.dateTime.getHours()
    let locationGroup = 'unknown'
    let timeGroup = 'night'
    if (hour >= 5 && hour < 12) timeGroup = 'morning'
    if (hour >= 12 && hour < 17) timeGroup = 'afternoon'
    if (hour >= 17 && hour < 21) timeGroup = 'evening'

    if (photo.metadata.location) {
      // Simple location grouping by grid
      const latGroup = Math.floor(photo.metadata.location?.latitude)
      const lngGroup = Math.floor(photo.metadata.location?.longitude)
      locationGroup = `${latGroup},${lngGroup}`
    }

    return {
      timeGroup,
      locationGroup
    }
  }

  /**
   * Groups similar photos together based on temporal proximity and visual similarity.
   * Used to avoid selecting multiple similar photos as highlights.
   * @param photos - Array of photos to group
   * @returns Map of group IDs to arrays of similar photos
   */
  private groupSimilarPhotos(photos: EnhancedPhoto[]): Map<string, EnhancedPhoto[]> {
    const groups = new Map<string, EnhancedPhoto[]>()
    const processedIds = new Set<string>()

    photos.forEach(photo => {
      if (processedIds.has(photo.id)) return

      const similarPhotos = [photo]
      processedIds.add(photo.id)

      // Find similar photos based on multiple criteria
      photos.forEach(otherPhoto => {
        if (photo.id === otherPhoto.id || processedIds.has(otherPhoto.id)) return

        const isSimilar = this.checkPhotoSimilarity(photo, otherPhoto)
        if (isSimilar) {
          similarPhotos.push(otherPhoto)
          processedIds.add(otherPhoto.id)
        }
      })

      groups.set(photo.id, similarPhotos)
    })

    return groups
  }

  /**
   * Checks if two photos are similar based on multiple criteria including
   * time taken, location, and visual content.
   * @param photo1 - First photo to compare
   * @param photo2 - Second photo to compare
   * @returns Boolean indicating if photos are similar
   */
  private checkPhotoSimilarity(photo1: EnhancedPhoto, photo2: EnhancedPhoto): boolean {
    // Time proximity check
    const timeThreshold = 5 * 60 * 1000 // 5 minutes
    const timeDiff = Math.abs(photo1.dateTime.getTime() - photo2.dateTime.getTime())
    if (timeDiff > timeThreshold) return false

    // Location proximity check if available
    if (photo1.metadata.location && photo2.metadata.location) {
      const distanceThreshold = 100 // 100 meters
      const distance = calculateDistance(photo1.metadata.location, photo2.metadata.location)
      if (distance > distanceThreshold) return false
    }

    /**
     * Calculates similarity between two photos based on their detected labels.
     * Uses Jaccard similarity coefficient (intersection over union).
     * @param photo1 - First photo to compare
     * @param photo2 - Second photo to compare
     * @returns Similarity score between 0 and 1
     */
    const calculateLabelSimilarity = (photo1: EnhancedPhoto, photo2: EnhancedPhoto): number => {
      const labels1 = new Set(photo1.analysis.labels.map(l => l.description))
      const labels2 = new Set(photo2.analysis.labels.map(l => l.description))

      if (labels1.size === 0 || labels2.size === 0) return 0

      const intersection = new Set([...labels1].filter(x => labels2.has(x)))
      const union = new Set([...labels1, ...labels2])

      return intersection.size / union.size
    }

    // Visual similarity checks
    const similarityScores = {
      labels: calculateLabelSimilarity(photo1, photo2),
      webEntities: calculateWebEntitySimilarity(photo1, photo2),
      visualFeatures: calculateVisualFeatureSimilarity(photo1, photo2)
    }

    // Weighted combination of similarity scores
    const totalSimilarity = similarityScores.labels * 0.4 + similarityScores.webEntities * 0.3 + similarityScores.visualFeatures * 0.3

    return totalSimilarity > 0.8
  }

  /**
   * Selects diverse highlights from grouped photos ensuring temporal distribution
   * and avoiding similar photos.
   * @param groups - Map of photo groups
   * @param options - Selection options including limits and preferences
   * @returns Array of selected highlight photos
   */
  private selectDiverseHighlights(groups: Map<string, EnhancedPhoto[]>, options: HighlightOptions): EnhancedPhoto[] {
    // Create time buckets covering the specified range
    const timeBuckets = this.createTimeBuckets(options.timeRange)
    const photosPerBucket = Math.ceil(options.limit / timeBuckets.length)

    const selectedPhotos: EnhancedPhoto[] = []
    const usedGroups = new Set<string>()

    // Select photos for each time bucket
    timeBuckets.forEach(bucket => {
      const eligibleGroups = this.getEligibleGroupsForBucket(groups, bucket, usedGroups, options.minQuality)

      const bucketSelections = this.selectBestGroupsFromBucket(eligibleGroups, photosPerBucket, selectedPhotos)

      bucketSelections.forEach(photo => {
        selectedPhotos.push(photo)
        usedGroups.add(photo.id)
      })
    })

    // If we still need more photos, fill with best remaining photos
    if (selectedPhotos.length < options.limit) {
      const remainingSelections = this.selectRemainingBestPhotos(
        groups,
        usedGroups,
        options.limit - selectedPhotos.length,
        options.minQuality
      )

      selectedPhotos.push(...remainingSelections)
    }

    // Ensure we don't exceed the limit
    return selectedPhotos.slice(0, options.limit)
  }

  /**
   * Creates time buckets for temporal diversity in highlight selection.
   * Divides the time range into equal intervals.
   * @param timeRange - Start and end time for selection
   * @returns Array of time bucket objects with start and end times
   */
  private createTimeBuckets(timeRange: HighlightOptions['timeRange']): Array<{ start: Date; end: Date }> {
    const buckets: Array<{ start: Date; end: Date }> = []
    const totalDuration = timeRange.end.getTime() - timeRange.start.getTime()
    const bucketDuration = totalDuration / 10 // Create 10 buckets

    for (let time = timeRange.start.getTime(); time < timeRange.end.getTime(); time += bucketDuration) {
      buckets.push({
        start: new Date(time),
        end: new Date(Math.min(time + bucketDuration, timeRange.end.getTime()))
      })
    }

    return buckets
  }

  /**
   * Filters photo groups that are eligible for selection within a time bucket.
   * Considers quality threshold and previously used groups.
   * @param groups - All photo groups
   * @param bucket - Time bucket to filter for
   * @param usedGroups - Set of already used group IDs
   * @param minQuality - Minimum quality threshold
   * @returns Map of eligible groups for the bucket
   */
  private getEligibleGroupsForBucket(
    groups: Map<string, EnhancedPhoto[]>,
    bucket: { start: Date; end: Date },
    usedGroups: Set<string>,
    minQuality: number
  ): Map<string, EnhancedPhoto[]> {
    const eligible = new Map<string, EnhancedPhoto[]>()

    groups.forEach((photos, groupId) => {
      if (usedGroups.has(groupId)) return

      const bucketPhotos = photos.filter(
        photo => photo.dateTime >= bucket.start && photo.dateTime <= bucket.end && (photo.scores?.quality || 0) >= minQuality
      )

      if (bucketPhotos.length > 0) {
        eligible.set(groupId, bucketPhotos)
      }
    })

    return eligible
  }

  private selectBestGroupsFromBucket(
    eligibleGroups: Map<string, EnhancedPhoto[]>,
    count: number,
    alreadySelected: EnhancedPhoto[]
  ): EnhancedPhoto[] {
    const selections: EnhancedPhoto[] = []

    // Convert groups to array for sorting
    const sortedGroups = Array.from(eligibleGroups.values())
      .map(photos => ({
        photos,
        bestScore: Math.max(...photos.map(p => p.scores?.final || 0))
      }))
      .sort((a, b) => b.bestScore - a.bestScore)

    for (const group of sortedGroups) {
      if (selections.length >= count) break

      const bestPhoto = group.photos.reduce((best, current) =>
        (current.scores?.final || 0) > (best.scores?.final || 0) ? current : best
      )

      if (this.isPhotoDiverse(bestPhoto, [...alreadySelected, ...selections])) {
        selections.push(bestPhoto)
      }
    }

    return selections
  }

  private selectRemainingBestPhotos(
    groups: Map<string, EnhancedPhoto[]>,
    usedGroups: Set<string>,
    count: number,
    minQuality: number
  ): EnhancedPhoto[] {
    const candidates: EnhancedPhoto[] = []

    groups.forEach((photos, groupId) => {
      if (!usedGroups.has(groupId)) {
        candidates.push(...photos.filter(photo => (photo.scores?.quality || 0) >= minQuality))
      }
    })

    return candidates.sort((a, b) => (b.scores?.final || 0) - (a.scores?.final || 0)).slice(0, count)
  }

  private isPhotoDiverse(photo: EnhancedPhoto, selectedPhotos: EnhancedPhoto[]): boolean {
    return selectedPhotos.every(selected => !this.checkPhotoSimilarity(photo, selected))
  }

  /**
   * Updates frequency counters for labels and label combinations.
   * Used for calculating uniqueness scores of photos.
   * @param labels - Array of labels to update frequencies for
   */
  private updateLabelFrequencies(labels: Label[]): void {
    // Update individual label frequencies
    labels.forEach(label => {
      const count = this.labelFrequencies.individual.get(label.description) || 0
      this.labelFrequencies.individual.set(label.description, count + 1)
    })

    // Update label combination frequencies
    for (let i = 0; i < labels.length - 1; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const combo = [labels[i].description, labels[j].description].sort().join('|')
        const count = this.labelFrequencies.combinations.get(combo) || 0
        this.labelFrequencies.combinations.set(combo, count + 1)
      }
    }
  }
}
