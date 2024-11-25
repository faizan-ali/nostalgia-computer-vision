import type { protos } from '@google-cloud/vision'
import type { google } from '@google-cloud/vision/build/protos/protos'

// Type aliases for Google Cloud Vision types
export type GoogleFaceAnnotation = protos.google.cloud.vision.v1.IFaceAnnotation
export type GoogleLabelAnnotation = protos.google.cloud.vision.v1.IEntityAnnotation
export type GoogleLandmarkAnnotation = protos.google.cloud.vision.v1.IEntityAnnotation
export type GoogleImageProperties = protos.google.cloud.vision.v1.IImageProperties
export type GoogleWebDetection = protos.google.cloud.vision.v1.IWebDetection
export type GoogleSafeSearchAnnotation = protos.google.cloud.vision.v1.ISafeSearchAnnotation
export type AnnotateImageResponse = google.cloud.vision.v1.AnnotateImageResponse

export interface Photo {
  id: string
  url: string
  buffer: Buffer
  dateTime: Date
  metadata: PhotoMetadata
  interactions: PhotoInteractions
}

export interface PhotoMetadata {
  title?: string
  description?: string
  location?: {
    latitude: number
    longitude: number
  }
  tags?: string[]
}

export interface PhotoInteractions {
  viewCount: number
  shareCount: number
  isEdited: boolean
  lastViewed?: Date
}

export interface FaceAnalysis {
  boundingBox: BoundingBox
  landmarks: FaceLandmark[]
  emotions: EmotionScores
  confidence: number
  blurred: boolean
  headwear: boolean
}

export interface BoundingBox {
  left: number
  top: number
  width: number
  height: number
}

export interface FaceLandmark {
  type: string
  position: {
    x: number
    y: number
    z: number
  }
}

export interface EmotionScores {
  joy: number
  sorrow: number
  anger: number
  surprise: number
}

export interface Label {
  description: string
  score: number
  topicality: number
}

export interface Landmark {
  name: string
  score: number
  boundingBox: BoundingBox
  locations?: {
    latitude: number
    longitude: number
  }[]
}

export interface ImageProperties {
  dominantColors: Color[]
  brightness: number
  contrast: number
  sharpness: number
}

export interface Color {
  color: {
    red: number
    green: number
    blue: number
  }
  score: number
  pixelFraction: number
}

export interface QualityMetrics {
  blurScore: number
  exposureScore: number
  noiseScore: number
  compositionScore: number
}

export interface PhotoAnalysis {
  faces: FaceAnalysis[]
  labels: Label[]
  landmarks: Landmark[]
  imageProperties: ImageProperties
  webDetection: GoogleWebDetection
  safeSearch: GoogleSafeSearchAnnotation
  quality: QualityMetrics
  clustering: {
    timeGroup: string
    locationGroup: string
  }
}

export interface EnhancedPhoto extends Photo {
  analysis: PhotoAnalysis
  scores?: PhotoScores
}

export interface PhotoScores {
  quality: number
  interest: number
  emotion: number
  uniqueness: number
  relevance: number
  temporal: number
  final: number
}

export interface HighlightOptions {
  limit: number
  timeRange: {
    start: Date
    end: Date
  }
  minQuality: number
  preferredTypes: string[]
  weights?: {
    quality?: number
    interest?: number
    emotion?: number
    uniqueness?: number
    relevance?: number
    temporal?: number
  }
}

export interface LabelFrequencies {
  individual: Map<string, number>
  combinations: Map<string, number>
}

// Helper export typefor batch processing results
export interface BatchProcessingResult {
  success: EnhancedPhoto[]
  failed: Array<{
    photo: Photo
    error: Error
  }>
}
