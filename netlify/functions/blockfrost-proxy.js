export async function handler(event) {
  const { url, network } = event.queryStringParameters || {};

  if (!url || !network) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing url or network parameter" })
    };
  }

  // Select correct key based on network
  let key;
  switch (network) {
    case "mainnet":
      key = process.env.BLOCKFROST_MAIN_KEY;
      break;
    case "preprod":
      key = process.env.BLOCKFROST_PREPROD_KEY;
      break;
    case "preview":
      key = process.env.BLOCKFROST_PREVIEW_KEY;
      break;
    default:
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid network" })
      };
  }

  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing env var for ${network}` })
    };
  }

  try {
    const res = await fetch(url, {
      headers: { project_id: key }
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      body: text,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json"
      }
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
