import type { BoundingBox } from '@/lib/types'
import type { protos } from '@google-cloud/vision'

/**
 * Converts Google Vision API bounding polygon to standardized bounding box format.
 * @param poly - Bounding polygon from Google Vision API
 * @returns Standardized bounding box
 */
export const convertBoundingPoly = (poly: protos.google.cloud.vision.v1.IBoundingPoly | null | undefined): BoundingBox => {
  if (!poly || !poly.vertices || poly.vertices.length < 4) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }

  const vertices = poly.vertices
  const left = Math.min(...vertices.map(v => v.x || 0))
  const top = Math.min(...vertices.map(v => v.y || 0))
  const right = Math.max(...vertices.map(v => v.x || 0))
  const bottom = Math.max(...vertices.map(v => v.y || 0))

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  }
}

/**
 * Converts Google Vision API likelihood enum to numeric score.
 * @param likelihood - Likelihood enum from Google Vision API
 * @returns Numeric score between 0 and 1
 */
export const convertLikelihood = (likelihood: protos.google.cloud.vision.v1.Likelihood | null | undefined): number => {
  const likelihoodMap = {
    UNKNOWN: 0,
    VERY_UNLIKELY: 0,
    UNLIKELY: 0.25,
    POSSIBLE: 0.5,
    LIKELY: 0.75,
    VERY_LIKELY: 1
  }

  return likelihoodMap[likelihood || 'UNKNOWN'] || 0
}
