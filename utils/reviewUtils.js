export const getRatingText = (rating) => {
    switch (Number(rating)) {
        case 1: return "Terrible";
        case 2: return "Bad";
        case 3: return "Okay";
        case 4: return "Good";
        case 5: return "Great";
        default: return "No Rating";
    }
};

/**
 * Formats a single review object consistently
 * @param {Object} review - The review object (plain JS or Mongoose)
 * @param {String} currentUserId - The ID of the currently logged-in user
 * @returns {Object} Formatted review
 */
export const formatReviewResponse = (review, currentUserId = null) => {
    // Convert to plain object if it's a Mongoose document
    const r = typeof review.toObject === 'function' ? review.toObject() : review;
    
    return {
        ...r,
        ratingText: getRatingText(r.rating),
        likesCount: r.likes?.length || 0,
        dislikesCount: r.dislikes?.length || 0,
        likedByUser: currentUserId && r.likes ? r.likes.some(id => id.toString() === currentUserId.toString()) : false,
        dislikedByUser: currentUserId && r.dislikes ? r.dislikes.some(id => id.toString() === currentUserId.toString()) : false
    };
};

/**
 * Formats an array of review objects consistently
 * @param {Array} reviews - Array of review objects
 * @param {String} currentUserId - The ID of the currently logged-in user
 * @returns {Array} Formatted reviews
 */
export const formatReviewsResponse = (reviews, currentUserId = null) => {
    if (!Array.isArray(reviews)) return [];
    return reviews.map(r => formatReviewResponse(r, currentUserId));
};
