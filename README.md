# Nostalgia

Ever wish you could look back in time and relive great memories buried in your photos? Nostlagia tries to help.

An intelligent photo selection system that uses Google Cloud Vision API to automatically identify and select the best photos from a collection, with a focus on quality, diversity, and emotional impact.

**Note:**
Built this mostly through a conversation with Claude and a bunch of trial and error.
This is a proof of concept and not a production-ready system. **I'm moving over to an approach that primarily leverages LLMs with some basic computer vision for filtering. Stay tuned**

## Features

- Automated photo analysis using Google Cloud Vision API
- Intelligent selection of highlights based on multiple criteria:
  - Image quality (blur, exposure, noise, composition)
  - Interest level (faces, landmarks, activities)
  - Emotional content
  - Visual uniqueness
  - Temporal diversity
- Support for Google Photos integration
- Comprehensive photo analysis including:
  - Face detection and emotion analysis
  - Landmark detection
  - Label detection
  - Image properties analysis
  - Web entity detection
  - Safe search detection

## Prerequisites

- Google Cloud Platform account with Vision API enabled
- Google Photos API access
- Node.js installed
- Environment variables set up:
  ```
  GOOGLE_SERVICE_ACCOUNT_CREDENTIALS=
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  GOOGLE_REDIRECT_URI=
  GOOGLE_REFRESH_TOKEN=
  ```

## Selection Criteria

The system uses a sophisticated scoring system that considers:
- Image quality metrics (blur, exposure, noise, composition)
- Face detection and emotion analysis
- Landmark recognition
- Visual similarity detection
- Temporal distribution
- Label frequency and uniqueness
- Color composition
- Layout analysis