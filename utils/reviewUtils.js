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


export const formatReviewResponse = (review, currentUserId = null) => {
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

export const formatReviewsResponse = (reviews, currentUserId = null) => {
    if (!Array.isArray(reviews)) return [];
    return reviews.map(r => formatReviewResponse(r, currentUserId));
};
