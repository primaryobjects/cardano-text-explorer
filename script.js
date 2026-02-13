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

// Find block by approximate timestamp using binary search
async function findBlockByTimestamp(baseUrl, targetTime, startBlock, endBlock) {
  // targetTime is in seconds (UNIX timestamp)
  let left = startBlock.height;
  let right = endBlock.height;
  let bestBlock = null;
  let bestDiff = Infinity;

  const maxIterations = 20;

  for (let i = 0; i < maxIterations && left <= right; i++) {
    const midHeight = Math.floor((left + right) / 2);

    try {
      const block = await fetchJson(`${baseUrl}/blocks/${midHeight}`);

      if (!block) break;

      const diff = Math.abs(block.time - targetTime);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestBlock = block;
      }

      // If we're very close (within 5 minutes = 300 seconds), return this block
      if (diff < 300) {
        return block;
      }

      // Adjust search range
      if (block.time > targetTime) {
        // Block is too recent, search earlier blocks
        right = midHeight - 1;
      } else {
        // Block is too old, search newer blocks
        left = midHeight + 1;
      }
    } catch (err) {
      console.warn(`Binary search failed at height ${midHeight}`, err);
      break;
    }
  }

  return bestBlock;
}

// Get block range for date filters using binary search
async function getBlockRangeForDates(baseUrl, dateFrom, dateTo) {
  // Convert date strings to UNIX timestamps in **seconds** (Blockfrost uses seconds)
  const fromTime = dateFrom ? Math.floor(Date.parse(dateFrom + 'T00:00:00Z') / 1000) : 0;
  const toTime = dateTo ? Math.floor(Date.parse(dateTo + 'T23:59:59.999Z') / 1000) : Infinity;

  const latestBlock = await fetchJson(`${baseUrl}/blocks/latest`);
  const startHeight = 1; // Genesis block
  const endHeight = latestBlock.height;

  let startBlock = latestBlock;
  let endBlock = null;

  // If we have a dateTo filter, find the block at or just after the end date
  if (toTime !== Infinity) {
    const blockAtTo = await findBlockByTimestamp(baseUrl, toTime, {height: startHeight, hash: ''}, {height: endHeight});
    if (blockAtTo) {
      endBlock = blockAtTo;
    }
    // If no block found (date too far future), use latestBlock (latest possible)
  }

  // If we have a dateFrom filter, find the block at or just before the start date
  if (fromTime > 0) {
    const blockAtFrom = await findBlockByTimestamp(baseUrl, fromTime, {height: startHeight, hash: ''}, {height: endHeight});
    if (blockAtFrom) {
      startBlock = blockAtFrom;
    } else {
      // Date too far in the past, fetch from the earliest possible block
      startBlock = { height: 0 }; // Will cause loop to go until previous_block is null
    }
  }

  return { startBlock, endBlock };
}

async function fetchLatestTxHashes(baseUrl, limit, dateFrom = null, dateTo = null) {
  // If no date filters, use simple approach
  if (!dateFrom && !dateTo) {
    return fetchLatestTxHashesSimple(baseUrl, limit);
  }

  // Convert date range to seconds
  const fromTime = dateFrom ? Math.floor(Date.parse(dateFrom + 'T00:00:00Z') / 1000) : 0;
  const toTime   = dateTo   ? Math.floor(Date.parse(dateTo   + 'T23:59:59.999Z') / 1000) : Infinity;

  // 1. Find block range using binary search
  const { startBlock, endBlock } = await getBlockRangeForDates(baseUrl, dateFrom, dateTo);

  const startHeight = startBlock.height;
  const endHeight   = endBlock ? endBlock.height : (await fetchJson(`${baseUrl}/blocks/latest`)).height;

  let txs = [];

  // 2. Walk heights downward (NOT block-by-block)
  for (let h = endHeight; h >= startHeight; h--) {
    if (txs.length >= limit) break;

    // Fetch txs for this block
    const blockTxs = await fetchJson(`${baseUrl}/blocks/${h}/txs`);

    if (!Array.isArray(blockTxs) || blockTxs.length === 0) continue;

    // Fetch block time once
    const block = await fetchJson(`${baseUrl}/blocks/${h}`);

    // Skip blocks outside date range
    if (block.time > toTime) continue;
    if (block.time < fromTime) break;

    // Add txs
    blockTxs.forEach(txHash => {
      txs.push({
        hash: txHash,
        blockTime: block.time
      });
    });
  }

  return txs.slice(0, limit);
}

// Simple version without date filters (original logic)
async function fetchLatestTxHashesSimple(baseUrl, limit) {
  let txs = [];
  let block = await fetchJson(`${baseUrl}/blocks/latest`);

  while (txs.length < limit) {
    const blockTxs = await fetchJson(`${baseUrl}/blocks/${block.hash}/txs`);
    const txWithTime = blockTxs.map(txHash => ({
      hash: txHash,
      blockTime: block.time
    }));
    txs.push(...txWithTime);

    if (!block.previous_block) break;
    block = await fetchJson(`${baseUrl}/blocks/${block.previous_block}`);
  }

  return txs.slice(0, limit);
}

async function fetchTransactionDetails(baseUrl, txHash) {
  try {
    const txDetails = await fetchJson(`${baseUrl}/txs/${txHash}/utxos`);
    return txDetails;
  } catch (err) {
    console.warn("Failed to fetch tx details for", txHash, err);
    return null;
  }
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
  const regexFilter = regexFilterInput ? regexFilterInput.value.trim() : '';
  const walletFilter = walletFilterInput ? walletFilterInput.value.trim() : '';
  const dateFrom = dateFromInput ? dateFromInput.value : '';
  const dateTo = dateToInput ? dateToInput.value : '';
  const usingDateFilters = (dateFrom || dateTo) && !labelFilter; // Only when using date filters without label

  // Warn about incompatible filters
  if (labelFilter && (dateFrom || dateTo)) {
    if (!silent) {
      alert('Note: Date filters are not compatible with label search. The label search uses a different API endpoint that does not support date filtering. Remove the label filter to use date filtering.');
    }
  }

  if (!silent) {
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Searching…";
    fetchBtn.classList.add("loading");
  }

  statusEl.classList.remove("error");
  if (!silent) {
    statusEl.textContent = usingDateFilters ? "Locating target blocks…" : "Fetching latest transactions…";
    summaryEl.textContent = "Loading…";
    resultsEl.innerHTML = "";
  }

  try {
    const baseUrl = getBaseUrl(network);

    // Check if date filters are being used (for status message)
    const usingDateFilters = (dateFrom || dateTo);

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
      updateStatistics(txWithMetadata);
      if (!silent) {
        statusEl.textContent = "Done.";
        fetchBtn.disabled = false;
      }

      loadMoreBtn.style.display = "block";

      return;
    }

        loadMoreBtn.style.display = "none";

    const txHashesWithTime = await fetchLatestTxHashes(baseUrl, limit, dateFrom || null, dateTo || null);

    if (!Array.isArray(txHashesWithTime) || txHashesWithTime.length === 0) {
      statusEl.textContent = "No transactions found in the latest block.";
      summaryEl.textContent = "No transactions.";
      fetchBtn.disabled = false;
      return;
    }

    statusEl.textContent = `Found ${txHashesWithTime.length} txs in latest block. Fetching metadata…`;

    const txWithMetadata = [];

    // 3. For each tx, fetch metadata
    let index = 0;
    for (const txTime of txHashesWithTime) {
      const hash = txTime.hash;
      index++;
      // Always update status so live (silent) mode shows progress
      statusEl.textContent = `Fetching metadata ${index}/${txHashesWithTime.length}…`;

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
              blockTime: txTime.blockTime
            });
          }
        }
      } catch (err) {
        // Ignore individual tx errors, continue
        console.warn("Metadata fetch failed for tx", hash, err);
      }
    }

        // Apply additional filters
    let filteredResults = txWithMetadata;

    // Apply regex filter
    if (regexFilter) {
      try {
        const regexPattern = new RegExp(regexFilter, 'i');
        filteredResults = filteredResults.map(tx => ({
          ...tx,
          metadata: tx.metadata.filter(meta => regexPattern.test(meta.text))
        })).filter(tx => tx.metadata.length > 0);
      } catch (err) {
        console.warn("Invalid regex pattern", err);
      }
    }

    // Apply wallet filter - needs to fetch transaction details
    if (walletFilter) {
      const walletLower = walletFilter.toLowerCase();
      const filteredWithWallet = [];

      for (const tx of filteredResults) {
        try {
          const txDetails = await fetchTransactionDetails(baseUrl, tx.hash);
          if (!txDetails) continue;

          const hasWallet =
            txDetails.inputs?.some(input =>
              (input.address && input.address.toLowerCase().includes(walletLower)) ||
              (input.payment_cred && input.payment_cred.toLowerCase().includes(walletLower))
            ) ||
            txDetails.outputs?.some(output =>
              (output.address && output.address.toLowerCase().includes(walletLower)) ||
              (output.payment_cred && output.payment_cred.toLowerCase().includes(walletLower))
            );

          if (hasWallet) {
            filteredWithWallet.push(tx);
          }
        } catch (err) {
          console.warn("Error checking wallet for tx", tx.hash, err);
        }
      }

      filteredResults = filteredWithWallet;
    }

    if (silent) {
      // In live mode, prepend any new transactions to existing results
      const previous = window._lastResults || [];
      const existing = new Set(previous.map((r) => r.hash));
      const newOnes = filteredResults.filter((t) => !existing.has(t.hash));

      if (newOnes.length === 0) {
        statusEl.textContent = "No new transactions.";
        return;
      }

      const combined = [...newOnes, ...previous];
      renderResults(combined);
      updateStatistics(combined);
      statusEl.textContent = `Added ${newOnes.length} new transaction(s).`;
      if (tailToggle && tailToggle.checked) {
        // Scroll to show the newest (prepended) item
        resultsEl.firstChild?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      renderResults(filteredResults);
      updateStatistics(filteredResults);
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
const regexFilterInput = document.getElementById("regexFilter");
const walletFilterInput = document.getElementById("walletFilter");
const dateFromInput = document.getElementById("dateFrom");
const dateToInput = document.getElementById("dateTo");
const exportCSVBtn = document.getElementById("exportCSVBtn");
const exportJSONBtn = document.getElementById("exportJSONBtn");
const saveSearchBtn = document.getElementById("saveSearchBtn");
const loadSearchBtn = document.getElementById("loadSearchBtn");
const savedSearchesDropdown = document.getElementById("savedSearchesDropdown");
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const statsPanel = document.getElementById("statsPanel");
const statsGrid = document.getElementById("statsGrid");
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

// Statistics functions
function updateStatistics(txWithMetadata) {
  if (!statsPanel || !statsGrid) return;

  const totalTxs = txWithMetadata.length;
  const totalMetadataItems = txWithMetadata.reduce((sum, tx) => sum + tx.metadata.length, 0);
  const uniqueLabels = new Set(txWithMetadata.flatMap(tx => tx.metadata.map(m => m.label)));
  const totalCharacters = txWithMetadata.reduce((sum, tx) =>
    sum + tx.metadata.reduce((txSum, meta) => txSum + (meta.text?.length || 0), 0), 0
  );

  const stats = [
    { label: "Transactions", value: totalTxs },
    { label: "Metadata Items", value: totalMetadataItems },
    { label: "Unique Labels", value: uniqueLabels.size },
    { label: "Total Characters", value: formatNumber(totalCharacters) }
  ];

  statsGrid.innerHTML = stats.map(stat => `
    <div class="stat-item">
      <span class="stat-value">${stat.value}</span>
      <span class="stat-label">${stat.label}</span>
    </div>
  `).join('');

  if (totalTxs > 0) {
    statsPanel.style.display = 'block';
  } else {
    statsPanel.style.display = 'none';
  }
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Export functions
function exportCSV() {
  const data = window._lastResults || [];
  if (data.length === 0) {
    alert('No data to export.');
    return;
  }

  const headers = ['Transaction Hash', 'Metadata Label', 'Text', 'Block Time'];
  const rows = data.flatMap(tx =>
    tx.metadata.map(meta => [
      tx.hash,
      meta.label,
      `"${(meta.text || '').replace(/"/g, '""')}"`,
      tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : ''
    ])
  );

  const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
  downloadFile('cardano-metadata.csv', csvContent, 'text/csv');
}

function exportJSON() {
  const data = window._lastResults || [];
  if (data.length === 0) {
    alert('No data to export.');
    return;
  }

  const exportData = data.map(tx => ({
    hash: tx.hash,
    blockTime: tx.blockTime,
    blockTimeFormatted: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    metadata: tx.metadata.map(meta => ({
      label: meta.label,
      text: meta.text
    }))
  }));

  const jsonContent = JSON.stringify(exportData, null, 2);
  downloadFile('cardano-metadata.json', jsonContent, 'application/json');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Saved searches using localStorage
const SAVED_SEARCHES_KEY = 'cardano-explorer-saved-searches';

function getSavedSearches() {
  try {
    const saved = localStorage.getItem(SAVED_SEARCHES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.warn('Failed to parse saved searches', e);
    return [];
  }
}

function saveSearch(name) {
  const searches = getSavedSearches();
  const currentSearch = {
    name: name,
    network: networkSelect.value,
    label: labelFilterInput.value.trim(),
    regex: regexFilterInput.value.trim(),
    wallet: walletFilterInput.value.trim(),
    dateFrom: dateFromInput.value,
    dateTo: dateToInput.value,
    limit: limitInput.value,
    savedAt: new Date().toISOString()
  };

  // Remove existing with same name
  const filtered = searches.filter(s => s.name !== name);
  filtered.unshift(currentSearch); // add to beginning

  // Keep only last 20 saved searches
  const trimmed = filtered.slice(0, 20);

  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(trimmed));
  alert(`Search "${name}" saved!`);
}

function loadSearch(search) {
  networkSelect.value = search.network || 'mainnet';
  labelFilterInput.value = search.label || '';
  regexFilterInput.value = search.regex || '';
  walletFilterInput.value = search.wallet || '';
  dateFromInput.value = search.dateFrom || '';
  dateToInput.value = search.dateTo || '';
  limitInput.value = search.limit || '20';
}

// Simple prompt to save current search
function promptSaveSearch() {
  const name = prompt('Enter a name for this search configuration:');
  if (name && name.trim()) {
    saveSearch(name.trim());
    refreshSavedSearchesDropdown();
  }
}

function refreshSavedSearchesDropdown() {
  if (!savedSearchesDropdown) return;

  const searches = getSavedSearches();
  savedSearchesDropdown.innerHTML = '';

  if (searches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.textContent = 'No saved searches';
    savedSearchesDropdown.appendChild(empty);
    return;
  }

  searches.forEach(search => {
    const item = document.createElement('a');
    item.href = '#';
    item.innerHTML = `
      <span>${escapeHtml(search.name)}</span>
      <span class="delete-btn" data-name="${escapeHtml(search.name)}">✕</span>
    `;

    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.target.classList.contains('delete-btn')) {
        e.stopPropagation();
        const nameToDelete = e.target.dataset.name;
        deleteSavedSearch(nameToDelete);
        refreshSavedSearchesDropdown();
      } else {
        loadSearch(search);
        savedSearchesDropdown.style.display = 'none';
      }
    });

    savedSearchesDropdown.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '');
}

function deleteSavedSearch(name) {
  const searches = getSavedSearches();
  const filtered = searches.filter(s => s.name !== name);
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(filtered));
}

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+S to save search
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    promptSaveSearch();
  }

  // Ctrl+E to export CSV
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault();
    exportCSV();
  }

  // Ctrl+Shift+E to export JSON
  if (e.ctrlKey && e.shiftKey && e.key === 'E') {
    e.preventDefault();
    exportJSON();
  }

  // Ctrl+F to focus search (label filter)
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    labelFilterInput.focus();
  }
});

// Event listeners for export and save buttons
if (exportCSVBtn) {
  exportCSVBtn.addEventListener("click", exportCSV);
}

if (exportJSONBtn) {
  exportJSONBtn.addEventListener("click", exportJSON);
}

if (saveSearchBtn) {
  saveSearchBtn.addEventListener("click", promptSaveSearch);
}

if (loadSearchBtn && savedSearchesDropdown) {
  loadSearchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    savedSearchesDropdown.style.display =
      savedSearchesDropdown.style.display === 'block' ? 'none' : 'block';
  });

    // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    if (savedSearchesDropdown.style.display === 'block') {
      savedSearchesDropdown.style.display = 'none';
    }
  });

  // Initial population
  refreshSavedSearchesDropdown();
}

// Help modal functionality
if (helpBtn && helpModal) {
  helpBtn.addEventListener('click', () => {
    helpModal.style.display = 'flex';
  });

  const modalClose = helpModal.querySelector('.modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      helpModal.style.display = 'none';
    });
  }

  // Close modal when clicking outside
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = 'none';
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal.style.display === 'flex') {
      helpModal.style.display = 'none';
    }
  });
}