import dotenv from 'dotenv'
import { OAuth2Client } from 'google-auth-library'

dotenv.config()

const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI)

// // Generate the url that will be used for authorization
// const authorizeUrl = oauth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope: ['https://www.googleapis.com/auth/photoslibrary.readonly']
// });
//
// console.log('Authorize this app by visiting this url:', authorizeUrl);

// After you get the authorization code from the URL, run this:
async function getToken(code: string) {
  const { tokens } = await oauth2Client.getToken(code)
  console.log('Refresh token:', tokens.refresh_token)
}

// Replace 'YOUR_AUTH_CODE' with the code you get from the authorization URL
getToken('asdf')
