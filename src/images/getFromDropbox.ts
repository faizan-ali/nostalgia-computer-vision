import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import dotenv from 'dotenv'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

// Load environment variables
dotenv.config()

interface DropboxImage {
  path_lower: string
  name: string
}

class DropboxImageFetcher {
  private dbx: Dropbox
  private outputDir: string

  constructor(accessToken: string, outputDir = './downloaded_images') {
    this.dbx = new Dropbox({ accessToken, fetch })
    this.outputDir = outputDir
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true })
      console.log(`Created output directory: ${this.outputDir}`)
    } catch (error) {
      console.error('Error creating output directory:', error)
      throw error
    }
  }

  async listImages(folderPath = ''): Promise<DropboxImage[]> {
    try {
      const response = await this.dbx.filesListFolder({
        path: folderPath,
        recursive: true
      })

      return response.result.entries.filter(
        entry => entry['.tag'] === 'file' && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(entry.path_lower)
      ) as DropboxImage[]
    } catch (error) {
      console.error('Error listing images:', error)
      throw error
    }
  }

  async downloadImage(imagePath: string): Promise<void> {
    try {
      const response = await this.dbx.filesDownload({ path: imagePath })
      const buffer = (response.result as any).fileBinary
      const fileName = path.basename(imagePath)
      const outputPath = path.join(this.outputDir, fileName)

      await fs.writeFile(outputPath, buffer)
      console.log(`Downloaded: ${fileName}`)
    } catch (error) {
      console.error(`Error downloading ${imagePath}:`, error)
      throw error
    }
  }

  async getImageProperties(imagePath: string) {
    try {
      const response = await this.dbx.filesGetMetadata({ path: imagePath })
      return response.result
    } catch (error) {
      console.error(`Error fetching properties for ${imagePath}:`, error)
      throw error
    }
  }

  async downloadAllImages(folderPath = ''): Promise<void> {
    try {
      await this.initialize()
      const images = await this.listImages(folderPath)

      console.log(`Found ${images.length} images`)

      for (const image of images) {
        await this.downloadImage(image.path_lower)
      }

      console.log('All images downloaded successfully!')
    } catch (error) {
      console.error('Error in batch download:', error)
      throw error
    }
  }
}

// Usage example
export const getFromDropbox = async () => {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN

  if (!accessToken) {
    throw new Error('DROPBOX_ACCESS_TOKEN not found in environment variables')
  }

  const fetcher = new DropboxImageFetcher(accessToken)
  const images = await fetcher.listImages('/Camera Uploads')
  await Promise.all(images.map(image => fetcher.getImageProperties(image.path_lower).then(console.log)))
}

getFromDropbox()
