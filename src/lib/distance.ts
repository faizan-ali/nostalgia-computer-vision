import { toRadians } from '@/lib/math'

interface Location {
  latitude: number
  longitude: number
}

/**
 * Calculates geographic distance between two locations using Haversine formula.
 * @param loc1 - First location with latitude and longitude
 * @param loc2 - Second location with latitude and longitude
 * @returns Distance in meters, or Infinity if locations not available
 */
export const calculateDistance = (loc1: Location, loc2: Location): number => {
  if (!loc1 || !loc2) return Number.POSITIVE_INFINITY

  const R = 6371e3 // Earth's radius in meters
  const φ1 = toRadians(loc1.latitude)
  const φ2 = toRadians(loc2.latitude)
  const Δφ = toRadians(loc2.latitude - loc1.latitude)
  const Δλ = toRadians(loc2.longitude - loc1.longitude)

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}
