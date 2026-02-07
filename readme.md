# Cardano Metadata Explorer

A web application for fetching and exploring metadata embedded in Cardano blockchain transactions. This project surfaces human-readable text from on-chain metadata using the Blockfrost API.

![Cardano Text Explorer](!screenshot1.png)

## Project Overview

This is a mobile-first, responsive web app that:
- Fetches the latest Cardano transactions from the blockchain
- Extracts and displays metadata text embedded on-chain
- Supports live updates to monitor new transactions
- Provides card and unique metadata views for analysis
- Works across multiple Cardano networks (Mainnet, Preview, Preprod)

## Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **API**: Blockfrost Cardano API
- **Deployment**: Netlify (serverless functions)
- **Proxy**: Netlify Functions for API requests

## Requirements

### Development
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Code editor (VS Code, etc.)
- Node.js (for local development/testing)
- Netlify CLI (optional, for local testing)

### Environment Variables

This project requires Blockfrost API keys for different networks. Set them as environment variables:

```bash
BLOCKFROST_MAIN_KEY=your_mainnet_api_key_here
BLOCKFROST_PREVIEW_KEY=your_preview_api_key_here
```

For Netlify deployment, configure the environment variables in the Netlify dashboard:
- Site settings → Build & deploy → Environment → Environment variables
- Add: `BLOCKFROST_MAIN_KEY` with your Mainnet API key value
- Add: `BLOCKFROST_PREVIEW_KEY` with your Preview API key value

## Project Structure

```
cardano-meta/
├── index.html          # Main HTML file with UI
├── script.js           # Core JavaScript functionality
├── styles.css          # Styling (not shown in current files)
├── netlify.toml        # Netlify configuration (create if needed)
├── functions/
│   └── blockfrost-proxy.js  # Netlify function for API proxy
└── readme.md           # This file
```

## Key Features

### Network Selection
- Mainnet: Production Cardano blockchain
- Preview: Test network for development
- Preprod: Pre-production environment

### Search Capabilities
- Latest transactions (configurable count, 1-20)
- Metadata label filtering (search by specific label)
- Live updates (auto-refresh every 20 seconds)
- Auto-scroll to newest results

### View Modes
- **Card View**: Individual transaction cards with metadata details
- **Unique Metadata**: Consolidated list of all unique metadata text

### Data Extraction
- Recursive JSON traversal to extract all string values
- Support for nested metadata structures
- Label-based filtering and organization

## API Integration

### Blockfrost Endpoints Used

1. **Latest Blocks**: `GET /blocks/latest`
2. **Block Transactions**: `GET /blocks/{hash}/txs`
3. **Transaction Metadata**: `GET /txs/{hash}/metadata`
4. **Label Search**: `GET /metadata/txs/labels/{label}`

### Proxy Setup

The app uses a Netlify function (`blockfrost-proxy.js`) to proxy requests to Blockfrost. This allows:
- Hiding the API key from client-side code
- Avoiding CORS issues
- Rate limiting control

## Deployment to Netlify

1. Commit changes to the `main` branch and push to the GitHub repo.

## Local Development

### Running Locally

1. **Install Dependencies**
   ```bash
   npm install -g netlify-cli
   ```

2. **Set Environment Variable**
   ```bash
   export BLOCKFROST_API_KEY=your_api_key_here
   ```

3. **Start Development Server**
   ```bash
   netlify dev
   ```

4. **Test the App**
   - Open `http://localhost:8888`
   - Test all features
   - Check browser console for errors

### Testing

- Test different network selections
- Verify metadata extraction works
- Test live update functionality
- Test label filtering
- Test responsive design on mobile

## API Usage Notes

- **Rate Limits**: Blockfrost has rate limits based on your subscription tier
- **Costs**: API calls may incur costs depending on your plan
- **Caching**: Consider implementing caching for better performance
- **Error Handling**: The app includes basic error handling for failed requests

## Security Considerations

- API key is stored server-side (Netlify environment variable)
- No sensitive data is exposed in client-side code
- HTTPS is enforced by Netlify
- Input validation for user parameters

## Performance Optimization

- Debounced live updates (20-second intervals)
- Lazy loading of transaction metadata
- Efficient DOM updates with innerHTML
- Minimal external dependencies

## Troubleshooting

### Common Issues

1. **API Key Not Set**
   - Ensure `BLOCKFROST_API_KEY` is configured in Netlify
   - Check environment variables locally

2. **CORS Errors**
   - Verify the proxy function is working
   - Check Netlify function logs

3. **No Metadata Found**
 - Some transactions may not have metadata
 - Check if the label filter is too restrictive
 - Verify network connectivity

4. **Live Updates Not Working**
   - Check browser console for errors
   - Verify JavaScript is running
   - Check network requests

## License

MIT

## Author

Kory Becker https://www.primaryobjects.com
