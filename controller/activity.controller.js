import axios from "axios";
import pLimit from "p-limit";
import { sendError, sendSuccess } from "../utils/responseUtils.js";
import hotelModel from "../model/hotel.model.js";
import stayModel from "../model/stay.model.js";
import watchListModel from "../model/watchlist.model.js";


const cityCache = new Map();
const attractionsCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 100;


const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter"
];

const callOverpass = async (query, timeout = 30000) => {
  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      const params = new URLSearchParams();
      params.append('data', query);
      const { data } = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
        timeout
      });
      return data;
    } catch (err) {
      console.warn(`Overpass mirror ${url} failed:`, err.message);
      lastError = err;
      continue;
    }
  }
  throw lastError;
};


const getCached = (cache, key) => {
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
};

const setCached = (cache, key, data) => {

  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, timestamp: Date.now() });
};


const fetchMultipleImagesForPlace = async (placeName, maxImages = 3) => {
  const staticImages = [
    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800",
    "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800",
    "https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=800"
  ];
  return staticImages.slice(0, maxImages);
};




const fetchOptimizedAttractions = async (cityName) => {
  const cached = getCached(attractionsCache, cityName);
  if (cached) return cached;

  const query = `
    [out:json][timeout:25];
    area["name"="${cityName}"]["boundary"="administrative"]->.a;
    
    (
      node["tourism"~"attraction|museum"](area.a);
      node["historic"](area.a);
      node["amenity"="place_of_worship"](area.a);
      node["leisure"="park"](area.a);
      way["tourism"~"attraction|museum"](area.a);
      way["historic"](area.a);
    );
    
    out tags center;
  `;

  try {
    const data = await callOverpass(query, 25000);
    const elements = data?.elements || [];

    const attractions = elements
      .map(el => {
        const name = el.tags?.name;
        if (!name) return null;

        const lat = el.center?.lat || el.lat;
        const lon = el.center?.lon || el.lon;
        if (!lat || !lon) return null;


        let score = 0;
        if (el.tags?.tourism === 'attraction') score += 3;
        if (el.tags?.historic) score += 2;
        if (el.tags?.amenity === 'place_of_worship') score += 1;

        return {
          name,
          lat,
          lon,
          tags: el.tags,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    setCached(attractionsCache, cityName, attractions);
    return attractions;
  } catch (err) {
    console.error("Overpass error:", err.message);
    return [];
  }
};


const createEnhancedGoogleMapsUrl = (lat, lng, name = "") => {
  const encodedName = encodeURIComponent(name);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${name ? ` (${encodedName})` : ""}`;
};



export const getAllCountries = async (req, res) => {
  try {

    const countries = await hotelModel.distinct("address.country");
    const allCountries = countries.filter(Boolean).map(name => ({ name }));

    return sendSuccess(res, "Countries fetched successfully", allCountries);
  } catch (error) {
    console.error("Error fetching database countries:", error);
    return sendError(res, "Failed to fetch countries from database", error.message);
  }
};


export const getCityByCountry = async (req, res) => {
  try {
    const { country } = req.params;

    const cityData = await hotelModel.aggregate([
      {
        $match: {
          "address.country": { $regex: new RegExp(`^${country}$`, "i") },
          "address.city": { $exists: true, $ne: "" }
        }
      },
      {
        $sort: {
          cityImage: -1
        }
      },
      {
        $group: {
          _id: "$address.city",
          cityImage: { $first: "$cityImage" }
        }
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          image: { $ifNull: ["$cityImage", null] }
        }
      }
    ]);

    return sendSuccess(res, "Cities fetched successfully", cityData);
  } catch (error) {
    console.error("Error fetching database cities:", error.message);
    return sendError(res, "Error while fetching cities from database", error.message);
  }
};


export const bestPlaceByCity = async (req, res) => {
  const { cityName } = req.params;

  if (!cityName || cityName.length < 2) {
    return res.status(400).json({ error: "Invalid city name" });
  }


  const cached = getCached(cityCache, cityName);
  if (cached) {
    return sendSuccess(res, "Best places fetched successfully (cached)", cached);
  }

  let results = [];

  try {
    res.set("X-Response-Type", "partial");


    const [dbHotels, dbStays] = await Promise.all([
      hotelModel.find({ "address.city": new RegExp(cityName, "i") }).lean(),
      stayModel.find({ city: new RegExp(cityName, "i") }).lean()
    ]);

    const dbResults = [
      ...dbHotels.map(h => ({
        id: h._id,
        type: "hotel",
        name: h.name,
        locationName: h.address?.country || "Global",
        cityName: h.address?.city,
        averageRating: h.averageRating || 0,
        latitude: h.location?.lat,
        longitude: h.location?.lng,
        images: h.images || [],
        primaryImage: h.images?.[0] || null,
        cityImage: h.cityImage || null,
        description: h.description,
        isDatabaseEntry: true
      })),
      ...dbStays.map(s => ({
        id: s._id,
        type: "stay",
        name: s.name,
        locationName: s.country || "India",
        cityName: s.city,
        averageRating: s.rating || 4.5,
        latitude: null,
        longitude: null,
        images: s.images || [],
        primaryImage: s.images?.[0] || null,
        description: s.description,
        isDatabaseEntry: true
      }))
    ];

    results.push(...dbResults);


    const attractions = await fetchOptimizedAttractions(cityName);


    const limit = pLimit(5);
    const BATCH_SIZE = 8;
    const TARGET_RESULTS = 15;

    for (let i = 0; i < attractions.length && results.length < TARGET_RESULTS; i += BATCH_SIZE) {
      const batch = attractions.slice(i, i + BATCH_SIZE);

      const batchTasks = batch.map((attr) =>
        limit(async () => {
          try {

            if (results.some(r => r.name.toLowerCase() === attr.name.toLowerCase())) return null;


            const images = await fetchMultipleImagesForPlace(attr.name, 2);
            if (!images.length) return null;


            const country = attr.tags?.["addr:country"] || attr.tags?.["is_in:country"] || "";

            return {
              name: attr.name,
              locationName: country || cityName,
              cityName: cityName,
              averageRating: 4.5,
              latitude: attr.lat,
              longitude: attr.lon,
              images,
              primaryImage: images[0],
              description: attr.tags?.description || null,
              type: attr.tags?.tourism || attr.tags?.historic || attr.tags?.amenity || "attraction",
              imageCount: images.length,
              mapUrl: createEnhancedGoogleMapsUrl(attr.lat, attr.lon, attr.name),
              isDatabaseEntry: false
            };
          } catch (error) {
            return null;
          }
        })
      );

      const batchResults = (await Promise.all(batchTasks)).filter(Boolean);
      results.push(...batchResults);

      if (results.length >= TARGET_RESULTS) break;
    }

    if (!results.length) {
      return res.status(404).json({ error: "No attractions with images found" });
    }


    setCached(cityCache, cityName, results);

    return sendSuccess(res, "Best places fetched successfully", results);
  } catch (err) {
    console.error("Server error:", err.message);

    if (results.length > 0) {
      return sendSuccess(res, "Best places fetched partially", results);
    }

    return sendError(res, "Error while fetching best places for this city", err);
  }
};


export const bestPlaceByCityBasic = async (req, res) => {
  const { cityName } = req.params;

  if (!cityName) {
    return res.status(400).json({ error: "Invalid city name" });
  }

  const cacheKey = `basic:${cityName}`;
  const cached = getCached(cityCache, cacheKey);
  if (cached) {
    return sendSuccess(res, "Basic attraction data fetched successfully (cached)", cached);
  }

  try {
    const attractions = await fetchOptimizedAttractions(cityName);
    const basicResults = attractions.slice(0, 20).map(attr => ({
      name: attr.name,
      latitude: attr.lat,
      longitude: attr.lon,
      type: attr.tags?.tourism || attr.tags?.historic || attr.tags?.amenity
    }));

    if (!basicResults.length) {
      return res.status(404).json({ error: "No attractions found for this city" });
    }

    setCached(cityCache, cacheKey, basicResults);
    return sendSuccess(res, "Basic attraction data fetched successfully", basicResults);
  } catch (err) {
    console.error("Server error:", err.message);
    return sendError(res, "Error while fetching basic attraction data", err);
  }
};

export const getHotelByCity = async (req, res) => {
  try {
    const { city } = req.params;

    if (!city || city.trim().length < 2) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or missing city name",
        data: null,
      });
    }

    const hotels = await hotelModel.find({ "address.city": new RegExp(city, "i") }).lean();

    let favoriteHotelIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteHotelIds = watchlist ? watchlist.hotels.map(id => id.toString()) : [];
    }

    const formattedResults = hotels.map(h => ({
      id: h._id,
      type: "hotel",
      name: h.name,
      locationName: h.address?.country || "Global",
      cityName: h.address?.city,
      averageRating: h.averageRating || 0,
      image: h.images?.[0] || null,
      cityImage: h.cityImage || null,
      address: `${h.address?.street || ''}, ${h.address?.city || ''}`.replace(/^, |, $/g, '').trim(),
      price: h.discountPrice || h.actualPrice,
      priceLabel: "Per Night",
      isFavorite: favoriteHotelIds.includes(h._id.toString())
    }));

    return sendSuccess(res, `Hotels found in ${city}`, formattedResults);

  } catch (error) {
    console.error("Error while fetching properties by city:", error);
    return sendError(res, "Error while fetching properties by city", error.message);
  }
};

