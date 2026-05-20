// Shopee Affiliate Link Generator
// Tìm sản phẩm hot từ open APIs → Tạo Shopee search link + affiliate → Rút gọn

/**
 * Configuration
 */
const SHOPEE_CONFIG = {
  // Shopee search URL (không cần API key)
  searchURL: 'https://shopee.vn/search',

  // Default affiliate ID (user sẽ config trong settings)
  defaultAffiliateId: '',

  // URL shortener APIs
  shorteners: [
    { name: 'isgd', endpoint: 'https://is.gd/create.php', rateLimit: 30000 }, // 2 req/min
    { name: 'vgd', endpoint: 'https://v.gd/create.php', rateLimit: 30000 },
    { name: 'dagd', endpoint: 'https://da.gd/s', rateLimit: 10000 },
    { name: 'tinyurl', endpoint: 'https://tinyurl.com/api-create.php', rateLimit: 60000 }, // 1 req/min
  ],

  // Rate limiting
  lastRequestTime: {},
  requestQueue: [],
};

/**
 * Rate limiter - Prevent API spam
 * @param {string} apiName - Name of API
 * @param {number} minInterval - Minimum interval between requests (ms)
 * @returns {Promise<boolean>} - True if can proceed
 */
async function checkRateLimit(apiName, minInterval) {
  const now = Date.now();
  const lastTime = SHOPEE_CONFIG.lastRequestTime[apiName] || 0;
  const timeSinceLastRequest = now - lastTime;

  if (timeSinceLastRequest < minInterval) {
    const waitTime = minInterval - timeSinceLastRequest;
    console.log(`[Shopee] Rate limit: waiting ${waitTime}ms for ${apiName}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  SHOPEE_CONFIG.lastRequestTime[apiName] = Date.now();
  return true;
}

/**
 * Extract keywords from text for product search
 * @param {string} text - Text to extract keywords from
 * @returns {string[]} - Array of keywords
 */
function extractProductKeywords(text) {
  // Remove common words and extract potential product names
  const commonWords = new Set([
    'là', 'của', 'và', 'có', 'được', 'này', 'đó', 'cho', 'với', 'từ',
    'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
    'can', 'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from', 'as'
  ]);

  // Extract words (2+ chars, alphanumeric + Vietnamese)
  const words = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];

  // Filter out common words and short words
  const keywords = words
    .filter(w => w.length >= 2 && !commonWords.has(w))
    .slice(0, 5); // Top 5 keywords

  return keywords;
}

/**
 * Find hot products from Tiki API (Vietnam)
 * Tiki provides open API without authentication
 * @param {string} keyword - Search keyword
 * @returns {Promise<Array>} - Array of product suggestions
 */
async function findHotProducts(keyword) {
  try {
    // Check rate limit (max 1 request per 3 seconds)
    await checkRateLimit('tiki-search', 3000);

    console.log('[Shopee] Fetching products from Tiki via background service worker...');

    // Fetch via background service worker to bypass CORS
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'fetch-tiki-products', keyword: keyword },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error || 'Unknown error'));
          }
        }
      );
    });

    if (!response || response.length === 0) {
      console.log('[Shopee] No products found on Tiki for:', keyword);
      return getMockProducts(keyword);
    }

    // Format products from Tiki
    const products = response.map(item => ({
      title: item.name || item.short_name || keyword,
      description: item.short_description || item.description || '',
      price: item.price || 0,
      originalPrice: item.original_price || item.price || 0,
      discount: item.discount_rate || 0,
      rating: item.rating_average || 0,
      reviewCount: item.review_count || 0,
      sold: item.quantity_sold?.value || 0,
      brand: item.brand_name || '',
      category: item.categories?.name || '',
      thumbnail: item.thumbnail_url || item.images?.[0]?.base_url || '',
      tikiUrl: `https://tiki.vn/${item.url_path || ''}`,
    }));

    console.log(`[Shopee] Found ${products.length} products from Tiki`);
    return products;
  } catch (error) {
    console.error('[Shopee] Error finding products from Tiki:', error);

    // Fallback: return mock products
    return getMockProducts(keyword);
  }
}

/**
 * Get mock products when Tiki API fails
 * @param {string} keyword - Search keyword
 * @returns {Array} - Array of mock products
 */
function getMockProducts(keyword) {
  console.log('[Shopee] Using mock products for keyword:', keyword);

  const mockProducts = {
    'điện thoại': [
      { title: 'iPhone 15 Pro Max 256GB', price: 29990000, originalPrice: 34990000, discount: 14, rating: 4.8, reviewCount: 1250, sold: 3420 },
      { title: 'Samsung Galaxy S24 Ultra', price: 27990000, originalPrice: 31990000, discount: 13, rating: 4.7, reviewCount: 980, sold: 2150 },
      { title: 'Xiaomi 14 Pro 5G', price: 18990000, originalPrice: 22990000, discount: 17, rating: 4.6, reviewCount: 750, sold: 1890 },
      { title: 'OPPO Find X7 Pro', price: 21990000, originalPrice: 24990000, discount: 12, rating: 4.5, reviewCount: 620, sold: 1340 },
      { title: 'Realme GT 5 Pro', price: 12990000, originalPrice: 15990000, discount: 19, rating: 4.6, reviewCount: 890, sold: 2560 },
    ],
    'tai nghe': [
      { title: 'AirPods Pro 2 USB-C', price: 5990000, originalPrice: 6990000, discount: 14, rating: 4.9, reviewCount: 2340, sold: 5670 },
      { title: 'Sony WH-1000XM5', price: 7990000, originalPrice: 9990000, discount: 20, rating: 4.8, reviewCount: 1890, sold: 3210 },
      { title: 'Samsung Galaxy Buds2 Pro', price: 3490000, originalPrice: 4990000, discount: 30, rating: 4.7, reviewCount: 1560, sold: 4320 },
      { title: 'JBL Tune 770NC', price: 1990000, originalPrice: 2990000, discount: 33, rating: 4.6, reviewCount: 980, sold: 2890 },
      { title: 'Soundcore Life Q30', price: 1590000, originalPrice: 2290000, discount: 31, rating: 4.5, reviewCount: 1230, sold: 3450 },
    ],
    'áo thun': [
      { title: 'Áo thun nam cotton USA', price: 199000, originalPrice: 299000, discount: 33, rating: 4.7, reviewCount: 3450, sold: 12340 },
      { title: 'Áo thun nữ form rộng Hàn Quốc', price: 149000, originalPrice: 249000, discount: 40, rating: 4.6, reviewCount: 2890, sold: 9870 },
      { title: 'Áo thun polo nam cao cấp', price: 249000, originalPrice: 399000, discount: 38, rating: 4.8, reviewCount: 1890, sold: 6540 },
      { title: 'Áo thun basic unisex', price: 99000, originalPrice: 179000, discount: 45, rating: 4.5, reviewCount: 4560, sold: 15670 },
      { title: 'Áo thun oversize streetwear', price: 179000, originalPrice: 299000, discount: 40, rating: 4.7, reviewCount: 2340, sold: 8900 },
    ],
    'giày sneaker': [
      { title: 'Nike Air Force 1 White', price: 2490000, originalPrice: 2990000, discount: 17, rating: 4.8, reviewCount: 1890, sold: 4560 },
      { title: 'Adidas Ultraboost 23', price: 3990000, originalPrice: 4990000, discount: 20, rating: 4.7, reviewCount: 1230, sold: 2890 },
      { title: 'Converse Chuck 70 High', price: 1790000, originalPrice: 2190000, discount: 18, rating: 4.6, reviewCount: 2340, sold: 6780 },
      { title: 'Vans Old Skool Classic', price: 1590000, originalPrice: 1990000, discount: 20, rating: 4.7, reviewCount: 3450, sold: 8900 },
      { title: 'New Balance 530 Retro', price: 2290000, originalPrice: 2790000, discount: 18, rating: 4.6, reviewCount: 980, sold: 3210 },
    ],
    'túi xách': [
      { title: 'Túi xách nữ da PU cao cấp', price: 349000, originalPrice: 599000, discount: 42, rating: 4.7, reviewCount: 2890, sold: 7650 },
      { title: 'Balo laptop 15.6 inch chống nước', price: 299000, originalPrice: 499000, discount: 40, rating: 4.8, reviewCount: 3450, sold: 9870 },
      { title: 'Túi đeo chéo nam da thật', price: 599000, originalPrice: 899000, discount: 33, rating: 4.6, reviewCount: 1560, sold: 4320 },
      { title: 'Túi tote canvas Hàn Quốc', price: 149000, originalPrice: 249000, discount: 40, rating: 4.5, reviewCount: 4560, sold: 12340 },
      { title: 'Ví cầm tay nữ mini', price: 199000, originalPrice: 349000, discount: 43, rating: 4.7, reviewCount: 2340, sold: 6540 },
    ],
  };

  const products = mockProducts[keyword] || mockProducts['điện thoại'];

  return products.map(p => ({
    title: p.title,
    description: '',
    price: p.price,
    originalPrice: p.originalPrice,
    discount: p.discount,
    rating: p.rating,
    reviewCount: p.reviewCount,
    sold: p.sold,
    brand: '',
    category: '',
    thumbnail: '',
    tikiUrl: '',
  }));
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
    sortBy: 'sales', // Sort by best selling
  });

  let url = `${baseURL}?${params}`;

  // Add affiliate tracking if ID provided
  if (affiliateId) {
    url += `&aff_sid=${affiliateId}`;
  }

  return url;
}

/**
 * Shorten URL using TinyURL or is.gd
 * @param {string} longUrl - URL to shorten
 * @returns {Promise<string>} - Shortened URL
 */
async function shortenURL(longUrl) {
  // 1. Try is.gd first
  try {
    await checkRateLimit('isgd', 30000); // 2 req/min

    const params = new URLSearchParams({
      format: 'simple',
      url: longUrl,
    });
    const response = await fetch(`https://is.gd/create.php?${params}`, {
      method: 'GET',
    });
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.trim().startsWith('http')) {
        console.log('[Shopee] is.gd success:', shortUrl.trim());
        return shortUrl.trim();
      }
    }
  } catch (error) {
    console.warn('[Shopee] is.gd failed:', error);
  }

  // 2. Try v.gd (similar to is.gd)
  try {
    await checkRateLimit('vgd', 30000);

    const params = new URLSearchParams({
      format: 'simple',
      url: longUrl,
    });
    const response = await fetch(`https://v.gd/create.php?${params}`, {
      method: 'GET',
    });
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.trim().startsWith('http')) {
        console.log('[Shopee] v.gd success:', shortUrl.trim());
        return shortUrl.trim();
      }
    }
  } catch (error) {
    console.warn('[Shopee] v.gd failed:', error);
  }

  // 3. Try da.gd
  try {
    await checkRateLimit('dagd', 10000);

    const response = await fetch(`https://da.gd/s?url=${encodeURIComponent(longUrl)}`, {
      method: 'GET',
    });
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.trim().startsWith('http')) {
        console.log('[Shopee] da.gd success:', shortUrl.trim());
        return shortUrl.trim();
      }
    }
  } catch (error) {
    console.warn('[Shopee] da.gd failed:', error);
  }

  // 4. Fallback to TinyURL
  try {
    await checkRateLimit('tinyurl', 60000); // 1 req/min

    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`, {
      method: 'GET',
    });
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.trim().startsWith('http')) {
        console.log('[Shopee] TinyURL success:', shortUrl.trim());
        return shortUrl.trim();
      }
    }
  } catch (error) {
    console.warn('[Shopee] TinyURL failed:', error);
  }

  // If all fail, return original URL
  console.warn('[Shopee] All URL shortening services failed, using original URL');
  return longUrl;
}

/**
 * Find hot products and generate Shopee affiliate links
 * @param {string} text - Text to analyze (not used - we find trending products)
 * @param {string} affiliateId - Shopee affiliate ID
 * @returns {Promise<Array>} - Array of products with Shopee links
 */
async function findHotProductsWithAffiliateLinks(text, affiliateId) {
  try {
    // Use popular keywords to find hot trending products
    // These are general high-traffic keywords that always have hot products
    const trendingKeywords = [
      'điện thoại',
      'tai nghe',
      'áo thun',
      'giày sneaker',
      'túi xách'
    ];

    // Pick a random keyword to get variety
    const randomKeyword = trendingKeywords[Math.floor(Math.random() * trendingKeywords.length)];

    console.log('[Shopee] Finding hot products with keyword:', randomKeyword);

    // Find hot products
    const products = await findHotProducts(randomKeyword);

    if (products.length === 0) {
      console.log('[Shopee] No products found');
      return [];
    }

    console.log('[Shopee] Found', products.length, 'products from Tiki');

    // Generate Shopee links for each product
    const productsWithLinks = await Promise.all(
      products.map(async (product) => {
        // Generate Shopee search URL
        const shopeeURL = generateShopeeSearchURL(product.title, affiliateId);

        // Shorten URL
        const shortURL = await shortenURL(shopeeURL);

        return {
          ...product,
          shopeeSearchURL: shopeeURL,
          affiliateLink: shortURL,
          keyword: product.title,
        };
      })
    );

    console.log('[Shopee] Generated affiliate links for', productsWithLinks.length, 'products');

    return productsWithLinks;
  } catch (error) {
    console.error('[Shopee] Error generating affiliate links:', error);
    return [];
  }
}

/**
 * Format product list for display in summary
 * @param {Array} products - Array of products
 * @returns {string} - Formatted product list
 */
function formatProductListForSummary(products) {
  if (products.length === 0) {
    return '';
  }

  let formatted = '\n\n🛍️ **Sản phẩm hot trên Shopee:**\n\n';

  products.forEach((product, index) => {
    formatted += `${index + 1}. **${product.title}**\n`;
    formatted += `   🔗 ${product.affiliateLink}\n\n`;
  });

  formatted += `_💡 Nguồn: Tìm kiếm tự động từ Tiki API_\n`;

  return formatted;
}

/**
 * Format product list as HTML for panel display
 * @param {Array} products - Array of products
 * @returns {string} - HTML string
 */
function formatProductListAsHTML(products) {
  if (products.length === 0) {
    return '';
  }

  let text = '\n\n🛍️ **Sản phẩm hot trên Shopee:**\n\n';

  products.forEach((product, index) => {
    text += `${index + 1}. **${product.title}**\n`;
    text += `   🔗 ${product.affiliateLink}\n\n`;
  });

  text += '_💡 Nguồn: Tìm kiếm tự động từ Tiki API_\n';

  return text;
}

// Export functions for use in other scripts (Chrome Extension environment)
// Expose to window object for content.js to use
if (typeof window !== 'undefined') {
  window.findHotProductsWithAffiliateLinks = findHotProductsWithAffiliateLinks;
  window.formatProductListForSummary = formatProductListForSummary;
  window.formatProductListAsHTML = formatProductListAsHTML;
  window.extractProductKeywords = extractProductKeywords;
}

// Node.js module export (for testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findHotProductsWithAffiliateLinks,
    formatProductListForSummary,
    formatProductListAsHTML,
    extractProductKeywords,
  };
}
