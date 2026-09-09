// Error Dictionary - Structured error messages with actions
// Used by background.js and content.js for consistent error handling

const ERROR_TYPES = {
  // API Key errors
  NO_API_KEY: {
    code: 'NO_API_KEY',
    message: 'Chưa có khóa API',
    detail: 'Bạn cần thêm ít nhất một khóa API để bắt đầu sử dụng tiện ích.',
    action: 'Mở tiện ích → chọn tab "Khóa API" → Thêm khóa',
    actionButton: 'Thêm khóa',
    actionUrl: 'popup.html#apikeys',
    severity: 'error'
  },

  NO_AVAILABLE_KEY: {
    code: 'NO_AVAILABLE_KEY',
    message: 'Không tìm thấy khóa khả dụng',
    detail: 'Tất cả các khóa API hiện tại đã hết hạn mức tạm thời hoặc đang chờ reset.',
    action: 'Thêm khóa mới hoặc chờ hệ thống reset hạn mức',
    actionButton: 'Thêm khóa',
    actionUrl: 'popup.html#apikeys',
    severity: 'warning'
  },

  // Rate limit errors
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Hết hạn mức tạm thời (Rate limit)',
    detail: 'Khóa API đã dùng hết hạn mức tạm thời. Đang tự động chuyển sang khóa khác sau {countdown}s...',
    action: 'Đợi vài giây hoặc thêm khóa dự phòng',
    actionButton: 'Thêm khóa',
    actionUrl: 'popup.html#apikeys',
    severity: 'warning',
    retryable: true
  },

  ALL_KEYS_RATE_LIMITED: {
    code: 'ALL_KEYS_RATE_LIMITED',
    message: 'Tất cả khóa đều hết hạn mức',
    detail: 'Hạn mức sẽ được làm mới vào: {resetTime}',
    action: 'Thêm khóa mới hoặc quay lại sau',
    actionButton: 'Thêm khóa',
    actionUrl: 'popup.html#apikeys',
    severity: 'error'
  },

  // Network errors
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    message: 'Lỗi kết nối',
    detail: 'Không thể kết nối đến server. Kiểm tra internet.',
    action: 'Kiểm tra kết nối và thử lại',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  },

  TIMEOUT: {
    code: 'TIMEOUT',
    message: 'Quá thời gian chờ (Timeout)',
    detail: 'Yêu cầu xử lý quá 30 giây. Máy chủ AI có thể đang bận.',
    action: 'Thử lại sau vài giây',
    actionButton: 'Thử lại',
    severity: 'warning',
    retryable: true
  },

  // Content errors
  CONTENT_TOO_SHORT: {
    code: 'CONTENT_TOO_SHORT',
    message: 'Nội dung quá ngắn',
    detail: 'Cần ít nhất {minLength} ký tự để tóm tắt.',
    action: 'Chọn đoạn text dài hơn',
    severity: 'info'
  },

  CONTENT_TOO_LONG: {
    code: 'CONTENT_TOO_LONG',
    message: 'Nội dung quá dài',
    detail: 'Tối đa {maxLength} ký tự. Hiện tại: {currentLength} ký tự.',
    action: 'Chọn đoạn text ngắn hơn',
    severity: 'warning'
  },

  EMPTY_CONTENT: {
    code: 'EMPTY_CONTENT',
    message: 'Không có nội dung',
    detail: 'Bôi đen text trước khi tóm tắt.',
    action: 'Bôi đen text và thử lại',
    severity: 'info'
  },

  // Provider errors
  INVALID_PROVIDER: {
    code: 'INVALID_PROVIDER',
    message: 'Nhà cung cấp AI không hợp lệ',
    detail: 'Dịch vụ AI "{provider}" hiện chưa được hỗ trợ.',
    action: 'Chọn dịch vụ AI khác (Tự động/Groq/Gemini)',
    severity: 'error'
  },

  PROVIDER_ERROR: {
    code: 'PROVIDER_ERROR',
    message: 'Lỗi từ dịch vụ AI',
    detail: '{providerMessage}',
    action: 'Thử nhà cung cấp khác hoặc thử lại sau',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  },

  // Image errors
  IMAGE_TOO_LARGE: {
    code: 'IMAGE_TOO_LARGE',
    message: 'Ảnh quá lớn',
    detail: 'Kích thước tối đa: 12MB. Ảnh này: {size}MB.',
    action: 'Chọn ảnh nhỏ hơn',
    severity: 'warning'
  },

  IMAGE_FETCH_FAILED: {
    code: 'IMAGE_FETCH_FAILED',
    message: 'Không tải được ảnh',
    detail: 'URL ảnh không hợp lệ hoặc bị chặn.',
    action: 'Thử ảnh khác hoặc bỏ qua ảnh',
    severity: 'warning'
  },

  // Context errors
  CONTEXT_INVALIDATED: {
    code: 'CONTEXT_INVALIDATED',
    message: 'Tiện ích vừa được tải lại',
    detail: 'Tiện ích FeedWriter vừa được cập nhật hoặc reload.',
    action: 'Tải lại trang web (F5) để tiếp tục sử dụng',
    actionButton: 'Tải lại trang',
    severity: 'error'
  },

  // Generic errors
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    message: 'Lỗi không xác định',
    detail: '{errorMessage}',
    action: 'Thử lại hoặc báo lỗi cho developer',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  }
};

// Helper function to create structured error
function createError(errorType, params = {}) {
  const template = ERROR_TYPES[errorType] || ERROR_TYPES.UNKNOWN_ERROR;

  // Replace placeholders in detail
  let detail = template.detail;
  Object.keys(params).forEach(key => {
    detail = detail.replace(`{${key}}`, params[key]);
  });

  return {
    code: template.code,
    message: template.message,
    detail: detail,
    action: template.action,
    actionButton: template.actionButton,
    actionUrl: template.actionUrl,
    severity: template.severity,
    retryable: template.retryable || false,
    timestamp: Date.now()
  };
}

// Export for use in background.js and content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ERROR_TYPES, createError };
}
