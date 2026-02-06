function getBaseUrl(network) {
  // Blockfrost Cardano endpoints
  switch (network) {
    case "preprod":
      return "https://cardano-preprod.blockfrost.io/api/v0";
    case "preview":
      return "https://cardano-preview.blockfrost.io/api/v0";
    case "mainnet":
    default:
      return "https://cardano-mainnet.blockfrost.io/api/v0";
  }
}

function getCardanoscanUrl(network, hash) {
  switch (network) {
    case "preview":
      return `https://preview.cardanoscan.io/transaction/${hash}`;
    case "preprod":
      return `https://preprod.cardanoscan.io/transaction/${hash}`;
    case "mainnet":
    default:
      return `https://cardanoscan.io/transaction/${hash}`;
  }
}

async function fetchJson(url) {
  const network = networkSelect.value;

  const res = await fetch(
    `/.netlify/functions/blockfrost-proxy?url=${encodeURIComponent(url)}&network=${network}`
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

function extractTextFromMetadataItem(item) {
  // item: { label, json_metadata }
  const label = item.label;
  const json = item.json_metadata;

  const texts = [];

  function walk(node) {
    if (node == null) return;
    if (typeof node === "string") {
      texts.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  }

  walk(json);

  return {
    label,
    text: texts.join("\n"),
  };
}

function buildUniqueMetadataDump(txWithMetadata) {
  const set = new Set();

  txWithMetadata.forEach(tx => {
    tx.metadata.forEach(meta => {
      if (meta.text) {
        meta.text.split("\n").forEach(line => {
          const trimmed = line.trim();
          if (trimmed.length > 0) set.add(trimmed);
        });
      }
    });
  });

  return Array.from(set).join("\n");
}

function renderResults(txWithMetadata) {
  resultsEl.innerHTML = "";

  // Save last results globally so view mode can switch
  window._lastResults = txWithMetadata;

  // Update unique metadata textarea
  const uniqueDump = buildUniqueMetadataDump(txWithMetadata);
  uniqueText.value = uniqueDump;

  if (!txWithMetadata.length) {
    summaryEl.textContent = "No metadata text found in the latest transactions.";
    return;
  }

  summaryEl.textContent = `${txWithMetadata.length} transaction(s) with metadata text.`;

  txWithMetadata.forEach((tx) => {
    const card = document.createElement("div");
    card.className = "tx-card";

    const header = document.createElement("div");
    header.className = "tx-header";

    const hashEl = document.createElement("a");
    hashEl.className = "tx-hash";
    hashEl.href = getCardanoscanUrl(networkSelect.value, tx.hash);
    hashEl.textContent = tx.hash;
    hashEl.target = "_blank";
    hashEl.rel = "noopener noreferrer";

    const countEl = document.createElement("div");
    countEl.className = "tx-meta-count";
    countEl.textContent = `${tx.metadata.length} metadata item(s)`;

    header.appendChild(hashEl);
    header.appendChild(countEl);
    card.appendChild(header);

    tx.metadata.forEach((meta) => {
      const metaCard = document.createElement("div");
      metaCard.className = "meta-item";

      const labelEl = document.createElement("div");
      labelEl.className = "meta-label";
      labelEl.textContent = `Label: ${meta.label}`;

      const keyEl = document.createElement("div");
      keyEl.className = "meta-key";
      keyEl.textContent = meta.text ? "Extracted text:" : "No string values found in this metadata.";

      const textEl = document.createElement("div");
      textEl.className = "meta-text";
      textEl.textContent = meta.text || "";

      metaCard.appendChild(labelEl);
      metaCard.appendChild(keyEl);
      if (meta.text) metaCard.appendChild(textEl);

      card.appendChild(metaCard);
    });

    resultsEl.appendChild(card);
  });
}

async function fetchLatestTxHashes(baseUrl, limit) {
  let txs = [];
  let block = await fetchJson(`${baseUrl}/blocks/latest`);

  while (txs.length < limit) {
    const blockTxs = await fetchJson(
      `${baseUrl}/blocks/${block.hash}/txs`
    );

    txs.push(...blockTxs);

    if (!block.previous_block) break;

    block = await fetchJson(
      `${baseUrl}/blocks/${block.previous_block}`
    );
  }

  return txs.slice(0, limit);
}

async function fetchLatestMetadata(silent = false) {
  if (fetchBtn.disabled && !silent) return;

  if (!silent) {
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Searching…";
  }

  const network = networkSelect.value;
  const limit = Math.min(Math.max(parseInt(limitInput.value || "20", 10), 1), 50);
  const labelFilter = labelFilterInput.value.trim();

  if (!silent) {
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Searching…";
    fetchBtn.classList.add("loading");
  }

  statusEl.classList.remove("error");
  if (!silent) {
    statusEl.textContent = "Fetching latest transactions…";
    summaryEl.textContent = "Loading…";
    resultsEl.innerHTML = "";
  }

  try {
    const baseUrl = getBaseUrl(network);

    // If user entered a label, use Blockfrost's label search endpoint
    if (labelFilter) {
      if (!silent) {
        statusEl.textContent = `Searching for label ${labelFilter} (page ${labelPage})…`;
      }

      // Reset pagination if new label
      if (currentLabel !== labelFilter) {
        currentLabel = labelFilter;
        labelPage = 1;
      }

      const labelResults = await fetchJson(
        `${baseUrl}/metadata/txs/labels/${labelFilter}?count=${limit}&page=${labelPage}&order=desc`
      );

      labelPage++; // next page for "Load more"

      const txWithMetadata = labelResults.map((item) => {
        const extracted = extractTextFromMetadataItem({
          label: labelFilter,
          json_metadata: item.json_metadata
        });

        return {
          hash: item.tx_hash,
          metadata: [extracted]
        };
      });

      if (silent) {
        // Only update UI if results changed
        const oldDump = uniqueText.value.trim();
        const newDump = buildUniqueMetadataDump(txWithMetadata).trim();

        if (oldDump === newDump) {
          return; // no change, skip UI update
        }
      }

      renderResults(txWithMetadata);
      if (!silent) {
        statusEl.textContent = "Done.";
        fetchBtn.disabled = false;
      }

      loadMoreBtn.style.display = "block";

      return;
    }

    loadMoreBtn.style.display = "none";

    const txHashes = await fetchLatestTxHashes(baseUrl, limit);

    if (!Array.isArray(txHashes) || txHashes.length === 0) {
      statusEl.textContent = "No transactions found in the latest block.";
      summaryEl.textContent = "No transactions.";
      fetchBtn.disabled = false;
      return;
    }

    statusEl.textContent = `Found ${txHashes.length} txs in latest block. Fetching metadata…`;

    const txWithMetadata = [];

    // 3. For each tx, fetch metadata
    let index = 0;
    for (const hash of txHashes) {
      index++;
      // Always update status so live (silent) mode shows progress
      statusEl.textContent = `Fetching metadata ${index}/${txHashes.length}…`;

      try {
        const metadataItems = await fetchJson(
          `${baseUrl}/txs/${hash}/metadata`
        );

        if (Array.isArray(metadataItems) && metadataItems.length > 0) {
          let processed = metadataItems
            .map(extractTextFromMetadataItem)
            .filter((m) => m.text && m.text.trim().length > 0);

          // Fix label filter: allow numeric or string match
          if (labelFilter) {
            processed = processed.filter((m) =>
              m.label.toString() === labelFilter.toString()
            );
          }

          if (processed.length > 0) {
            txWithMetadata.push({
              hash,
              metadata: processed,
            });
          }
        }
      } catch (err) {
        // Ignore individual tx errors, continue
        console.warn("Metadata fetch failed for tx", hash, err);
      }
    }

    if (silent) {
      // In live mode, prepend any new transactions to existing results
      const previous = window._lastResults || [];
      const existing = new Set(previous.map((r) => r.hash));
      const newOnes = txWithMetadata.filter((t) => !existing.has(t.hash));

      if (newOnes.length === 0) {
        statusEl.textContent = "No new transactions.";
        return;
      }

      const combined = [...newOnes, ...previous];
      renderResults(combined);
      statusEl.textContent = `Added ${newOnes.length} new transaction(s).`;
      if (tailToggle && tailToggle.checked) {
        // Scroll to show the newest (prepended) item
        resultsEl.firstChild?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      renderResults(txWithMetadata);
      statusEl.textContent = "Done.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.classList.add("error");
    summaryEl.textContent = "Request failed.";
  } finally {
    if (!silent) {
      fetchBtn.disabled = false;
      fetchBtn.textContent = "Search";
      fetchBtn.classList.remove("loading");
    }
  }
}

const networkSelect = document.getElementById("network");
const limitInput = document.getElementById("limit");
const fetchBtn = document.getElementById("fetchBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const summaryEl = document.getElementById("summary");
const labelFilterInput = document.getElementById("labelFilter");
const viewCardsBtn = document.getElementById("viewCardsBtn");
const viewUniqueBtn = document.getElementById("viewUniqueBtn");
const uniqueContainer = document.getElementById("uniqueContainer");
const uniqueText = document.getElementById("uniqueText");
const liveToggle = document.getElementById("liveToggle");
const tailToggle = document.getElementById("tailToggle");
let liveInterval = null;

let labelPage = 1;
let currentLabel = null;

fetchBtn.addEventListener("click", () => fetchLatestMetadata(false));

viewCardsBtn.addEventListener("click", () => {
  uniqueContainer.style.display = "none";
  resultsEl.style.display = "flex";
});

viewUniqueBtn.addEventListener("click", () => {
  resultsEl.style.display = "none";
  uniqueContainer.style.display = "block";
});

const loadMoreBtn = document.getElementById("loadMoreBtn");

loadMoreBtn.addEventListener("click", async () => {
  if (!currentLabel) return;

  const network = networkSelect.value;
  const baseUrl = getBaseUrl(network);
  const limit = parseInt(limitInput.value || "20", 10);

  const labelResults = await fetchJson(
    `${baseUrl}/metadata/txs/labels/${currentLabel}?count=${limit}&page=${labelPage}&order=desc`
  );

  labelPage++;

  const newTx = labelResults.map((item) => {
    const extracted = extractTextFromMetadataItem({
      label: currentLabel,
      json_metadata: item.json_metadata
    });

    return {
      hash: item.tx_hash,
      metadata: [extracted]
    };
  });

  // Append to existing results
  const combined = [...window._lastResults, ...newTx];
  renderResults(combined);
});

liveToggle.addEventListener("change", () => {
  if (liveToggle.checked) {
    // Start live updates
    liveInterval = setInterval(() => {
      fetchLatestMetadata(true); // pass "silent" mode
    }, 20000); // 20 seconds
  } else {
    // Stop live updates
    clearInterval(liveInterval);
    liveInterval = null;
  }
});