import type { GoogleImageProperties } from '@/lib/types'

/**
 * Calculates overall brightness of an image from its color properties.
 * @param properties - Image properties from Google Vision API
 * @returns Brightness score between 0 and 1
 */
export const calculateBrightness = (properties: GoogleImageProperties): number => {
  if (!properties.dominantColors?.colors) return 0

  return properties.dominantColors.colors.reduce((sum, color) => {
    const rgb = color.color || {}
    const brightness = (((rgb.red || 0) + (rgb.green || 0) + (rgb.blue || 0)) / 3 / 255) * (color.pixelFraction || 0)
    return sum + brightness
  }, 0)
}

/**
 * Calculates image contrast from color properties.
 * Uses difference between brightest and darkest colors.
 * @param properties - Image properties from Google Vision API
 * @returns Contrast score between 0 and 1
 */
export const calculateContrast = (properties: GoogleImageProperties): number => {
  if (!properties.dominantColors?.colors) return 0

  const colors = properties.dominantColors.colors
  if (colors.length < 2) return 0

  const brightnesses = colors.map(color => {
    const rgb = color.color || {}
    return ((rgb.red || 0) + (rgb.green || 0) + (rgb.blue || 0)) / 3
  })

  const maxBrightness = Math.max(...brightnesses)
  const minBrightness = Math.min(...brightnesses)

  return (maxBrightness - minBrightness) / 255
}

/**
 * Estimates image sharpness based on color variations between adjacent colors.
 * @param properties - Image properties from Google Vision API
 * @returns Sharpness score between 0 and 1
 */
export const calculateSharpness = (properties: GoogleImageProperties): number => {
  // This is a simplified approximation based on color variations
  if (!properties.dominantColors?.colors) return 0

  const colors = properties.dominantColors.colors
  if (colors.length < 2) return 0

  // Calculate color variations between adjacent dominant colors
  let totalVariation = 0
  for (let i = 0; i < colors.length - 1; i++) {
    const color1 = colors[i].color || {}
    const color2 = colors[i + 1].color || {}

    const variation = Math.sqrt(
      ((color1.red || 0) - (color2.red || 0)) ** 2 +
        ((color1.green || 0) - (color2.green || 0)) ** 2 +
        ((color1.blue || 0) - (color2.blue || 0)) ** 2
    )

    totalVariation += variation
  }

  return Math.min(totalVariation / (colors.length - 1) / 442, 1) // 442 is max possible variation (sqrt(255^2 * 3))
}
