import cafeModel from "../model/cafe.model.js";
import hallModel from "../model/hall.model.js";
import hotelModel from "../model/hotel.model.js";
import restroModel from "../model/restro.model.js";
import { sendError } from "../utils/responseUtils.js";
import hotelBookingModel from "../model/hotel.booking.model.js";
import axios from "axios";
import stayModel from "../model/stay.model.js";
import coupanModel from "../model/coupan.model.js";
import offerModel from "../model/offer.model.js";

export const WhatsNew = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;

    const [hotels, restros, cafes, halls] = await Promise.all([
      hotelModel.find().sort({ createdAt: -1 }).limit(limit),
      restroModel.find().sort({ createdAt: -1 }).limit(limit),
      cafeModel.find().sort({ createdAt: -1 }).limit(limit),
      hallModel.find().sort({ createdAt: -1 }).limit(limit),
    ]);

    const normalizeImages = (item, type) => {
      const obj = item.toObject();
      let normalizedImages = {
        featured: null,
        gallery: [],
        menu: []
      };

      if (obj.images) {
        if (Array.isArray(obj.images)) {
          if (obj.images.length > 0) {
            normalizedImages.featured = obj.images[0];
            normalizedImages.gallery = obj.images.slice(1);
          }
        } else if (type === 'hall') {
          normalizedImages.featured = obj.images.featuredImage || null;
          normalizedImages.gallery = obj.images.galleryImages || [];
        } else if (type === 'restro') {
          normalizedImages.featured = obj.images.featured || null;
          normalizedImages.gallery = obj.images.gallery || [];
          normalizedImages.menu = obj.images.menu || [];
        } else {
          normalizedImages.featured = obj.images.featured || obj.images.featuredImage || null;
          normalizedImages.gallery = obj.images.gallery || obj.images.galleryImages || [];
          normalizedImages.menu = obj.images.menu || [];
        }
      }

      return {
        ...obj,
        type,
        images: normalizedImages
      };
    };

    const combined = [
      ...hotels.map((d) => normalizeImages(d, "hotel")),
      ...restros.map((d) => normalizeImages(d, "restro")),
      ...cafes.map((d) => normalizeImages(d, "cafe")),
      ...halls.map((d) => normalizeImages(d, "hall")),
    ];

    combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const recent = combined.slice(0, limit);

    return res.status(200).json({
      success: true,
      message: "Recent businesses fetched successfully",
      data: recent,
    });
  } catch (error) {
    console.error("Error fetching recent businesses:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching recent businesses",
    });
  }
}


export const getTrendingDestinations = async (req, res) => {
  try {
    const { limit = 8 } = req.query;

    
    const trendingCities = await getIndianTrendingCities(parseInt(limit));

    
    const destinationsWithImages = await Promise.all(
      trendingCities.map(async (city) => ({
        ...city,
        image_url: await getIndianCityImageFromUnsplash(city.name, city.state)
      }))
    );

    res.json({
      success: true,
      message: "Trending destinations fetched successfully",
      data: destinationsWithImages
    });

  } catch (error) {
    console.error("Trending destinations error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


const getIndianTrendingCities = async (limit = 8) => {
  try {
    
    const trendingByBookings = await hotelBookingModel.aggregate([
      {
        $match: {
          bookingStatus: { $in: ["Completed", "Upcoming", "pending"] }
        }
      },
      {
        $lookup: {
          from: "hotels", 
          localField: "hotelId",
          foreignField: "_id",
          as: "hotel"
        }
      },
      {
        $unwind: "$hotel"
      },
      {
        $match: {
          "hotel.address.city": { $exists: true, $ne: "" },
          
          $or: [
            { "hotel.address.country": "India" },
            { "hotel.address.country": { $exists: false } }, 
            { "hotel.address.country": "" } 
          ]
        }
      },
      {
        $group: {
          _id: {
            city: "$hotel.address.city",
            state: "$hotel.address.state",
            country: "$hotel.address.country" || "India"
          },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: "$pricing.totalAmount" },
          sampleHotelId: { $first: "$hotel._id" },
          sampleHotelName: { $first: "$hotel.name" },
          sampleImages: { $first: "$hotel.images" }
        }
      },
      {
        $sort: {
          bookingCount: -1,
          totalRevenue: -1
        }
      },
      {
        $limit: limit * 2 
      }
    ]);

    
    const popularByHotels = await hotelModel.aggregate([
      {
        $match: {
          "address.city": { $exists: true, $ne: "" },
          $or: [
            { "address.country": "India" },
            { "address.country": { $exists: false } },
            { "address.country": "" }
          ]
        }
      },
      {
        $group: {
          _id: {
            city: "$address.city",
            state: "$address.state",
            country: "$address.country" || "India"
          },
          hotelCount: { $sum: 1 },
          avgRating: { $avg: "$averageRating" },
          sampleImages: { $first: "$images" },
          sampleHotelName: { $first: "$name" }
        }
      },
      {
        $sort: {
          hotelCount: -1,
          avgRating: -1
        }
      },
      {
        $limit: limit * 2
      }
    ]);

    
    const processedBookings = trendingByBookings.map(item => formatIndianCityData(item, 'booking'));
    const processedHotels = popularByHotels.map(item => formatIndianCityData(item, 'hotel'));

    
    const cityMap = new Map();

    
    processedBookings.forEach(city => {
      const key = `${city.name.toLowerCase()}-${city.state.toLowerCase()}`;
      if (!cityMap.has(key)) {
        cityMap.set(key, city);
      }
    });

    
    processedHotels.forEach(city => {
      const key = `${city.name.toLowerCase()}-${city.state.toLowerCase()}`;
      if (!cityMap.has(key) && cityMap.size < limit) {
        cityMap.set(key, city);
      }
    });

    
    let result = Array.from(cityMap.values()).slice(0, limit);

    
    if (result.length < limit) {
      const additionalCities = getPopularIndianCities();
      additionalCities.forEach(city => {
        const key = `${city.name.toLowerCase()}-${city.state.toLowerCase()}`;
        if (!cityMap.has(key) && result.length < limit) {
          result.push(city);
        }
      });
    }

    return result;

  } catch (error) {
    console.error("Error analyzing Indian cities:", error);
    return getPopularIndianCities().slice(0, limit);
  }
};


const formatIndianCityData = (data, source) => {
  const cityName = data._id.city;
  const stateName = data._id.state || getIndianStateFromCity(cityName);

  return {
    id: `${cityName.toLowerCase().replace(/\s+/g, '-')}-${stateName.toLowerCase().replace(/\s+/g, '-')}`,
    name: cityName,
    state: stateName,
    country: "India",
    bookingCount: data.bookingCount || 0,
    hotelCount: data.hotelCount || 0,
    avgRating: data.avgRating ? Number(data.avgRating.toFixed(1)) : null,
    totalRevenue: data.totalRevenue || 0,
    local_image: data.sampleImages && data.sampleImages.length > 0 ? data.sampleImages[0] : null,
    searchQuery: `${cityName} ${stateName} India`,
    source: source
  };
};


const getIndianStateFromCity = (cityName) => {
  const cityStateMap = {
    'mumbai': 'Maharashtra',
    'delhi': 'Delhi',
    'bangalore': 'Karnataka',
    'chennai': 'Tamil Nadu',
    'kolkata': 'West Bengal',
    'hyderabad': 'Telangana',
    'pune': 'Maharashtra',
    'ahmedabad': 'Gujarat',
    'jaipur': 'Rajasthan',
    'surat': 'Gujarat',
    'lucknow': 'Uttar Pradesh',
    'kanpur': 'Uttar Pradesh',
    'nagpur': 'Maharashtra',
    'indore': 'Madhya Pradesh',
    'thane': 'Maharashtra',
    'bhopal': 'Madhya Pradesh',
    'visakhapatnam': 'Andhra Pradesh',
    'patna': 'Bihar',
    'vadodara': 'Gujarat',
    'ghaziabad': 'Uttar Pradesh',
    'ludhiana': 'Punjab',
    'kochi': 'Kerala',
    'coimbatore': 'Tamil Nadu',
    'varanasi': 'Uttar Pradesh',
    'madurai': 'Tamil Nadu',
    'goa': 'Goa',
    'nashik': 'Maharashtra',
    'faridabad': 'Haryana',
    'meerut': 'Uttar Pradesh',
    'rajkot': 'Gujarat',
    'jamshedpur': 'Jharkhand',
    'jabalpur': 'Madhya Pradesh'
  };

  return cityStateMap[cityName.toLowerCase()] || 'India';
};


const getIndianCityImageFromUnsplash = async (cityName, stateName) => {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      return getDefaultIndianCityImage(cityName);
    }

    
    const query = `${cityName} ${stateName} India city landscape tourism`;

    const response = await axios.get('https://api.unsplash.com/search/photos', {
      params: {
        query: query,
        per_page: 1,
        orientation: 'landscape',
        client_id: accessKey
      },
      timeout: 5000
    });

    if (response.data.results.length > 0) {
      return response.data.results[0].urls.regular;
    }

    
    const fallbackResponse = await axios.get('https://api.unsplash.com/search/photos', {
      params: {
        query: `${cityName} India city`,
        per_page: 1,
        orientation: 'landscape',
        client_id: accessKey
      },
      timeout: 5000
    });

    return fallbackResponse.data.results.length > 0
      ? fallbackResponse.data.results[0].urls.regular
      : getDefaultIndianCityImage(cityName);

  } catch (error) {
    console.log(`Unsplash failed for ${cityName}, using local image`);
    return getDefaultIndianCityImage(cityName);
  }
};


const getPopularIndianCities = () => {
  const popularIndianCities = [
    { city: "Mumbai", state: "Maharashtra" },
    { city: "Delhi", state: "Delhi" },
    { city: "Bangalore", state: "Karnataka" },
    { city: "Hyderabad", state: "Telangana" },
    { city: "Chennai", state: "Tamil Nadu" },
    { city: "Kolkata", state: "West Bengal" },
    { city: "Pune", state: "Maharashtra" },
    { city: "Jaipur", state: "Rajasthan" },
    { city: "Goa", state: "Goa" },
    { city: "Kerala", state: "Kerala" },
    { city: "Varanasi", state: "Uttar Pradesh" },
    { city: "Leh", state: "Ladakh" },
    { city: "Shimla", state: "Himachal Pradesh" },
    { city: "Udaipur", state: "Rajasthan" },
    { city: "Agra", state: "Uttar Pradesh" }
  ];

  return popularIndianCities.map(city => ({
    id: `${city.city.toLowerCase().replace(/\s+/g, '-')}-${city.state.toLowerCase().replace(/\s+/g, '-')}`,
    name: city.city,
    state: city.state,
    country: "India",
    bookingCount: 0,
    hotelCount: 0,
    avgRating: null,
    totalRevenue: 0,
    local_image: null,
    searchQuery: `${city.city} ${city.state} India`,
    source: 'predefined'
  }));
};


const getDefaultIndianCityImage = (cityName) => {
  const defaultImages = {
    'mumbai': 'https://images.unsplash.com/photo-1570160974745-2118db820464?w=800',
    'delhi': 'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800',
    'bangalore': 'https://images.unsplash.com/photo-1596760449250-d9b980d09798?w=800',
    'hyderabad': 'https://images.unsplash.com/photo-1572445271230-a78b5944a659?w=800',
    'chennai': 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?w=800',
    'kolkata': 'https://images.unsplash.com/photo-1558431382-27e39cbef4bc?w=800',
    'pune': 'https://images.unsplash.com/photo-1566371486490-560ded239dae?w=800',
    'jaipur': 'https://images.unsplash.com/photo-1599661046289-e31897846e41?w=800',
    'goa': 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800',
    'kerala': 'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=800',
    'varanasi': 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?w=800',
    'leh': 'https://images.unsplash.com/photo-1581793745862-99fde7fa73d2?w=800',
    'shimla': 'https://images.unsplash.com/photo-1562670225-48adc073bb18?w=800',
    'udaipur': 'https://images.unsplash.com/photo-1591544607730-845763914c81?w=800',
    'agra': 'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=800',
    'default': 'https://images.unsplash.com/photo-1514222139-b576be2ce086?w=800',
  };

  const key = cityName.toLowerCase();
  return defaultImages[key] || defaultImages.default;
};



export const getCoffeeDates = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 6;
    const cafes = await cafeModel.find({ status: 'active' })
      .sort({ averageRating: -1, createdAt: -1 })
      .limit(limit);

    const data = cafes.map(c => {
      const obj = c.toObject();
      let image = null;
      if (obj.images && obj.images.length > 0) {
        image = obj.images[0];
      }
      return {
        id: obj._id,
        name: obj.name,
        image: image,
        rating: obj.averageRating || 0,
        location: obj.location?.city || "",
        type: "cafe"
      };
    });

    res.json({
      success: true,
      message: "Coffee dates fetched successfully",
      data
    });
  } catch (error) {
    console.error("Coffee dates error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};



export const getBrowseByPropertyTypes = async (req, res) => {
  try {
    const hotelCount = await hotelModel.countDocuments();
    const restroCount = await restroModel.countDocuments({ status: "active" });
    const cafeCount = await cafeModel.countDocuments({ status: "active" });
    const hallCount = await hallModel.countDocuments({ isAvailable: true });

    
    
    const hotelSample = await hotelModel.findOne({ images: { $ne: [] } }).select('images');
    const restroSample = await restroModel.findOne({ 'images.featured': { $ne: null } }).select('images');
    const cafeSample = await cafeModel.findOne({ images: { $ne: [] } }).select('images');
    const hallSample = await hallModel.findOne({ 'images.featuredImage': { $ne: null } }).select('images');

    const data = [
      {
        type: "Hotel",
        count: hotelCount,
        image: hotelSample?.images?.[0] || "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
      },
      {
        type: "Restaurant",
        count: restroCount,
        image: restroSample?.images?.featured || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800",
      },
      {
        type: "Cafe",
        count: cafeCount,
        image: cafeSample?.images?.[0] || "https://images.unsplash.com/photo-1501339817308-5d3c11d04467?w=800",
      },
      {
        type: "Hall",
        count: hallCount,
        image: hallSample?.images?.featuredImage || "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800",
      }
    ];

    res.json({
      success: true,
      message: "Property types fetched successfully",
      data
    });
  } catch (error) {
    console.error("Property types error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};



export const getSpecialOffers = async (req, res) => {
  try {
    const topOffer = await offerModel.findOne({
      isActive: true
    })
      .sort({ createdAt: -1 });

    let discountText = "50% OFF";
    let title = "Get Up to";
    let subtitle = "on your dining";
    let backgroundImage = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200";

    if (topOffer) {
      if (topOffer.discountText) discountText = topOffer.discountText;
      if (topOffer.title) title = topOffer.title;
      if (topOffer.subtitle) subtitle = topOffer.subtitle;
      if (topOffer.backgroundImage) backgroundImage = topOffer.backgroundImage;
    }

    const data = {
      title,
      discountText,
      subtitle,
      backgroundImage
    };

    res.json({
      success: true,
      message: "Special offers fetched successfully",
      data
    });
  } catch (error) {
    console.error("Special offers error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};



export const getLuxuryStays = async (req, res) => {
  try {
    const { city, limit = 4 } = req.query;

    
    let query = {};
    if (city) {
      query["address.city"] = new RegExp(city, "i");
    }

    
    const luxuryHotels = await hotelModel.find(query)
      .sort({ averageRating: -1 }) 
      .limit(parseInt(limit));

    const formatHotel = (hotel) => {
      const obj = hotel.toObject();
      return {
        id: obj._id,
        name: obj.name,
        location: obj.address?.city || city || "Unknown",
        image: obj.images && obj.images.length > 0 ? obj.images[0] : "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
        rating: obj.averageRating || 5,
        price: obj.priceRange?.min || obj.Rent || 0
      };
    };

    let data = luxuryHotels.map(formatHotel);

    
    if (data.length === 0) {
      const fallbackHotels = await hotelModel.find({})
        .sort({ averageRating: -1 })
        .limit(parseInt(limit));

      data = fallbackHotels.map(formatHotel);
    }

    res.json({
      success: true,
      message: "Luxury stays fetched successfully",
      data
    });
  } catch (error) {
    console.error("Luxury stays error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
