// Shopee Pre-loaded Links System
// Generate 24 product links daily, use sequentially for each summary

/**
 * Pre-defined product list (24 hot products)
 */
const PRELOADED_PRODUCTS = [
  { title: 'iPhone 15 Pro Max 256GB', keyword: 'iPhone 15 Pro Max' },
  { title: 'Samsung Galaxy S24 Ultra', keyword: 'Samsung Galaxy S24' },
  { title: 'Xiaomi 14 Pro 5G', keyword: 'Xiaomi 14 Pro' },
  { title: 'AirPods Pro 2 USB-C', keyword: 'AirPods Pro 2' },
  { title: 'Sony WH-1000XM5', keyword: 'Sony WH-1000XM5' },
  { title: 'Samsung Galaxy Buds2 Pro', keyword: 'Galaxy Buds2 Pro' },
  { title: 'Áo thun nam cotton USA', keyword: 'áo thun nam cotton' },
  { title: 'Áo thun nữ form rộng Hàn Quốc', keyword: 'áo thun nữ form rộng' },
  { title: 'Áo polo nam cao cấp', keyword: 'áo polo nam' },
  { title: 'Nike Air Force 1 White', keyword: 'Nike Air Force 1' },
  { title: 'Adidas Ultraboost 23', keyword: 'Adidas Ultraboost' },
  { title: 'Converse Chuck 70 High', keyword: 'Converse Chuck 70' },
  { title: 'Túi xách nữ da PU cao cấp', keyword: 'túi xách nữ da' },
  { title: 'Balo laptop 15.6 inch chống nước', keyword: 'balo laptop 15.6' },
  { title: 'Túi đeo chéo nam da thật', keyword: 'túi đeo chéo nam' },
  { title: 'Đồng hồ thông minh Apple Watch', keyword: 'Apple Watch' },
  { title: 'Đồng hồ Casio G-Shock', keyword: 'Casio G-Shock' },
  { title: 'Máy sấy tóc Dyson', keyword: 'máy sấy tóc Dyson' },
  { title: 'Nồi chiên không dầu 5L', keyword: 'nồi chiên không dầu' },
  { title: 'Robot hút bụi lau nhà', keyword: 'robot hút bụi' },
  { title: 'Loa Bluetooth JBL', keyword: 'loa bluetooth JBL' },
  { title: 'Chuột gaming Logitech', keyword: 'chuột gaming Logitech' },
  { title: 'Bàn phím cơ gaming RGB', keyword: 'bàn phím cơ gaming' },
  { title: 'Webcam 1080p cho học online', keyword: 'webcam 1080p' },
];

/**
 * Get or initialize daily product links
 * @param {string} affiliateId - Shopee affiliate ID
 * @returns {Promise<Array>} - Array of 24 products with links
 */
async function getDailyProductLinks(affiliateId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Check if we have links for today
  const stored = await new Promise(resolve => {
    chrome.storage.local.get(['shopeeLinksDate', 'shopeeLinks'], resolve);
  });

  // If links exist and are from today, return them
  if (stored.shopeeLinksDate === today && stored.shopeeLinks && stored.shopeeLinks.length === PRELOADED_PRODUCTS.length) {
    // Check if links are shortened (not full shopee.vn URLs)
    const firstLink = stored.shopeeLinks[0]?.link || '';
    if (firstLink.includes('shopee.vn/search')) {
      console.log('[Shopee] Cached links are not shortened, regenerating...');
      // Clear old cache and regenerate
    } else {
      console.log('[Shopee] Using cached links from today:', today);
      return stored.shopeeLinks;
    }
  }

  // Generate new links for today
  console.log('[Shopee] Generating new links for:', today);

  // Generate links with URL shortening
  const links = [];
  for (const product of PRELOADED_PRODUCTS) {
    const shopeeURL = generateShopeeSearchURL(product.keyword, affiliateId);

    // Shorten URL
    let shortURL = shopeeURL;
    try {
      shortURL = await shortenURL(shopeeURL);
    } catch (error) {
      console.warn('[Shopee] Failed to shorten URL for:', product.title, error);
    }

    links.push({
      title: product.title,
      link: shortURL,
    });
  }

  // Save to storage
  await new Promise(resolve => {
    chrome.storage.local.set({
      shopeeLinksDate: today,
      shopeeLinks: links,
      shopeeLinksIndex: 0, // Reset index
    }, resolve);
  });

  console.log('[Shopee] Generated and saved 24 links for today');
  return links;
}

/**
 * Get next product link (sequential)
 * @param {string} affiliateId - Shopee affiliate ID
 * @returns {Promise<Object>} - Product with title and link
 */
async function getNextProductLink(affiliateId) {
  // Get daily links
  const links = await getDailyProductLinks(affiliateId);

  // Get current index
  const stored = await new Promise(resolve => {
    chrome.storage.local.get(['shopeeLinksIndex'], resolve);
  });

  let index = stored.shopeeLinksIndex || 0;

  // Wrap around if we've used all products
  if (index >= PRELOADED_PRODUCTS.length) {
    index = 0;
  }

  const product = links[index];

  // Increment index for next time
  await new Promise(resolve => {
    chrome.storage.local.set({ shopeeLinksIndex: index + 1 }, resolve);
  });

  console.log(`[Shopee] Using product ${index + 1}/24:`, product.title);
  return product;
}

/**
 * Generate Shopee search URL with affiliate ID
 * @param {string} keyword - Search keyword
 * @param {string} affiliateId - Affiliate ID
 * @returns {string} - Shopee search URL with affiliate tracking
 */
function generateShopeeSearchURL(keyword, affiliateId) {
  const baseURL = 'https://shopee.vn/search';
  const params = new URLSearchParams({
    keyword: keyword,
    order: 'desc',
    sortBy: 'sales',
  });

  let url = `${baseURL}?${params}`;

  if (affiliateId) {
    url += `&aff_sid=${affiliateId}`;
  }

  return url;
}

/**
 * Shorten URL using background service worker (bypass CORS)
 * @param {string} longUrl - URL to shorten
 * @returns {Promise<string>} - Shortened URL
 */
async function shortenURL(longUrl) {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'shorten-url', url: longUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.success) {
            resolve(response.shortUrl);
          } else {
            reject(new Error(response.error || 'Unknown error'));
          }
        }
      );
    });

    console.log('[Shopee] URL shortened:', response);
    return response;
  } catch (error) {
    console.warn('[Shopee] URL shortening failed:', error);
    return longUrl; // Return original URL if shortening fails
  }
}

/**
 * Format single product for display
 * @param {Object} product - Product object
 * @returns {string} - Formatted text
 */
function formatSingleProduct(product) {
  return `\n🛍️ GỢI Ý MUA SẮM:\n· Sản phẩm: ${product.title}\n· Link Shopee: ${product.link}`;
}

// Export functions
if (typeof window !== 'undefined') {
  window.getNextProductLink = getNextProductLink;
  window.formatSingleProduct = formatSingleProduct;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getNextProductLink,
    formatSingleProduct,
  };
}
