export const areColorsSimilar = (color1: string, color2: string): boolean => {
  const [r1, g1, b1] = color1.split(',').map(Number)
  const [r2, g2, b2] = color2.split(',').map(Number)

  const distance = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)

  return distance < 30 // Threshold for color similarity
}
