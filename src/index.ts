import { getImages } from '@/images/getFromGoogle'
import { GoogleVisionHighlightSelector } from '@/lib/highlighter/highlighter'
import type { Photo } from '@/lib/types'

if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS not found in environment variables')
}

const highlightSelector = new GoogleVisionHighlightSelector(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS))

interface ImageInput {
  url: string
  dateTaken: string
  location?: {
    latitude: number
    longitude: number
  }
}

async function selectHighlightsFromUrls(): Promise<any[]> {
  try {
    const imageInputs: ImageInput[] = (await getImages()).map(image => ({
      url: image.baseUrl,
      dateTaken: image.mediaMetadata.creationTime
    }))

    // Convert URLs to Photo objects
    const photos: Photo[] = await Promise.all(
      imageInputs.map(async (input, index) => {
        try {
          // Fetch image
          const response = await fetch(input.url)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`)
          }

          // Convert to buffer using arrayBuffer()
          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          // Create Photo object
          return {
            id: `photo-${index}`,
            url: input.url,
            buffer: buffer,
            dateTime: new Date(input.dateTaken),
            metadata: {
              location: input.location,
              title: `Photo ${index + 1}`
            },
            interactions: {
              viewCount: 0,
              shareCount: 0,
              isEdited: false
            }
          }
        } catch (error) {
          console.error(`Error processing ${input.url}:`, error)
          throw error
        }
      })
    )

    // Add photos to the selector
    const processingResult = await highlightSelector.addPhotos(photos)

    if (processingResult.failed.length > 0) {
      console.warn('Some photos failed processing')
    }

    // Select highlights
    const highlights = await highlightSelector.selectHighlights({
      limit: 10,
      timeRange: {
        start: new Date(Math.min(...photos.map(p => p.dateTime.getTime()))),
        end: new Date(Math.max(...photos.map(p => p.dateTime.getTime())))
      },
      minQuality: 0.6,
      preferredTypes: ['person', 'landscape', 'food', 'architecture'],
      weights: {
        quality: 0.3,
        interest: 0.2,
        emotion: 0.15,
        uniqueness: 0.15,
        relevance: 0.1,
        temporal: 0.1
      }
    })

    console.log(
      'Processing result:',
      JSON.stringify(
        processingResult.success.map(photo => ({ ...photo, buffer: undefined })),
        null,
        2
      )
    )
    console.log('Highlights:', highlights)
    return highlights
  } catch (error) {
    console.error('Error selecting highlights:', error)
    throw error
  }
}

selectHighlightsFromUrls().then(console.log).catch(console.error)
