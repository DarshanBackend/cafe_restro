import axios from "axios";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { sendError, sendSuccess } from "../utils/responseUtils.js";
import hotelModel from "../model/hotel.model.js";

// Enhanced cache configuration with LRU-like behavior
const cityCache = new Map();
const attractionsCache = new Map();
const imageCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100;

// HTTP client with optimized settings
const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Encoding": "identity",
  },
  maxRedirects: 5,
});

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
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

// Cache helper with automatic cleanup
const getCached = (cache, key) => {
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
};

const setCached = (cache, key, data) => {
  // LRU: remove oldest if cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, timestamp: Date.now() });
};

// Optimized image fetching with caching
const fetchDuckDuckGoImage = async (query) => {
  const cacheKey = `ddg:${query}`;
  const cached = getCached(imageCache, cacheKey);
  if (cached) return cached;

  try {
    const url = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}`;
    const res = await http.get(url);
    const image = res.data?.results?.[0]?.image || null;
    if (image) setCached(imageCache, cacheKey, image);
    return image;
  } catch {
    return null;
  }
};

const fetchBingImage = async (query, width = 512, height = 512) => {
  const cacheKey = `bing:${query}`;
  const cached = getCached(imageCache, cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`;
    const res = await http.get(url);
    const $ = cheerio.load(res.data);

    const first = $("a.iusc img.mimg").first();
    let src = first.attr("src") || first.attr("data-src") || $("img").first().attr("src");

    if (src && src.startsWith("http") && src.includes("tse")) {
      src = src.replace("&w=*", `&w=${width}`).replace("&h=*", `&h=${height}`);
      if (!src.includes("&w=")) src += `&w=${width}&h=${height}`;
    }
    if (src) setCached(imageCache, cacheKey, src);
    return src || null;
  } catch {
    return null;
  }
};

const fetchGoogleImage = async (query) => {
  const cacheKey = `google:${query}`;
  const cached = getCached(imageCache, cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    const res = await http.get(url);
    const $ = cheerio.load(res.data);
    const image = $("img").eq(1).attr("src") || null;
    if (image) setCached(imageCache, cacheKey, image);
    return image;
  } catch {
    return null;
  }
};

// Optimized parallel image fetching with early termination
const fetchMultipleImagesForPlace = async (placeName, maxImages = 3) => {
  const cacheKey = `images:${placeName}:${maxImages}`;
  const cached = getCached(imageCache, cacheKey);
  if (cached) return cached;

  try {
    const timeout = 2500; // Reduced to 2.5 seconds
    const sources = [
      () => fetchBingImage(placeName),      // Bing often fastest
      () => fetchDuckDuckGoImage(placeName),
      () => fetchGoogleImage(placeName)
    ];

    const images = [];
    const activePromises = [];

    // Race-based fetching: stop when we have enough images
    for (const fetchFn of sources) {
      if (images.length >= maxImages) break;

      const promise = Promise.race([
        fetchFn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
      ]).then(img => {
        if (img && img.startsWith('http') && !images.includes(img)) {
          images.push(img);
        }
        return img;
      }).catch(() => null);

      activePromises.push(promise);

      // Quick check: if we already have enough, don't wait
      if (images.length >= maxImages) break;
    }

    // Wait for remaining promises or until we have enough
    await Promise.allSettled(activePromises);

    const result = images.slice(0, maxImages);
    if (result.length > 0) {
      setCached(imageCache, cacheKey, result);
    }
    return result;
  } catch (error) {
    console.error(`Error fetching images for ${placeName}:`, error);
    return [];
  }
};

// Backward compatibility
const fetchOptimizedImage = async (query) => {
  const images = await fetchMultipleImagesForPlace(query, 1);
  return images.length > 0 ? images[0] : null;
};

// Streamlined Overpass query with caching
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

        // Optimized scoring
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
      .slice(0, 25); // Increased for better selection

    setCached(attractionsCache, cityName, attractions);
    return attractions;
  } catch (err) {
    console.error("Overpass error:", err.message);
    return [];
  }
};

// Optimized Google Maps URL
const createEnhancedGoogleMapsUrl = (lat, lng, name = "") => {
  const encodedName = encodeURIComponent(name);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodedName}`;
};

const STATIC_COUNTRIES = [
  { name: "USA", code: "US" }, { name: "Canada", code: "CA" }, { name: "UAE", code: "AE" },
  { name: "India", code: "IN" }, { name: "Brazil", code: "BR" }, { name: "United Kingdom", code: "GB" },
  { name: "Australia", code: "AU" }, { name: "Germany", code: "DE" }, { name: "France", code: "FR" },
  { name: "Japan", code: "JP" }, { name: "Singapore", code: "SG" }, { name: "Italy", code: "IT" },
  { name: "Spain", code: "ES" }, { name: "Netherlands", code: "NL" }, { name: "Switzerland", code: "CH" }
];

// Optimized getAllCountries with caching
export const getAllCountries = async (req, res) => {
  const cached = getCached(cityCache, 'all_countries');
  if (cached) {
    return sendSuccess(res, "All countries fetched successfully (cached)", cached);
  }

  try {
    const query = `
      [out:json][timeout:30];
      node["place"="country"];
      out tags;
    `;

    let data;
    try {
      data = await callOverpass(query, 20000); // Shorter timeout for faster fallback
    } catch (overpassError) {
      console.warn("Overpass failed, using static fallback countries");
      setCached(cityCache, 'all_countries', STATIC_COUNTRIES);
      return sendSuccess(res, "All countries fetched successfully (fallback)", STATIC_COUNTRIES);
    }

    const countries = (data.elements || [])
      .map((el) => ({
        name: el.tags?.name || el.tags?.["name:en"],
        code: el.tags?.["ISO3166-1"] || el.tags?.["ISO3166-1:alpha2"] || null,
      }))
      .filter((c) => c.name);

    // If Overpass returned nothing, use fallback
    const result = countries.length > 0 ? countries : STATIC_COUNTRIES;

    setCached(cityCache, 'all_countries', result);
    return sendSuccess(res, "All countries fetched successfully", result);
  } catch (error) {
    console.error("Error fetching countries:", error.message);
    // Absolute final fallback
    return sendSuccess(res, "All countries fetched successfully (emergency fallback)", STATIC_COUNTRIES);
  }
};

// Optimized getCityByCountry with caching
export const getCityByCountry = async (req, res) => {
  try {
    const { country } = req.params;
    const cacheKey = `cities:${country}`;

    const cached = getCached(cityCache, cacheKey);
    if (cached) {
      return sendSuccess(res, "Cities fetched successfully (cached)", cached);
    }

    const query = `
      [out:json][timeout:120];
      area["name"="${country}"]->.a;
      node["place"="city"](area.a);
      out tags;
    `;

    const data = await callOverpass(query, 120000);
    const elements = data.elements || [];
    const cityNames = elements.map(e => e.tags?.name).filter(Boolean);

    setCached(cityCache, cacheKey, cityNames);
    return sendSuccess(res, "Cities fetched successfully", cityNames);
  } catch (error) {
    console.error("Error fetching cities:", error.message);
    return sendError(res, "Error while fetching cities by country", error);
  }
};

// Highly optimized bestPlaceByCity
export const bestPlaceByCity = async (req, res) => {
  const { cityName } = req.params;

  if (!cityName || cityName.length < 2) {
    return res.status(400).json({ error: "Invalid city name" });
  }

  // Check cache
  const cached = getCached(cityCache, cityName);
  if (cached) {
    return sendSuccess(res, "Best places fetched successfully (cached)", cached);
  }

  let results = [];

  try {
    res.set("X-Response-Type", "partial");

    const attractions = await fetchOptimizedAttractions(cityName);
    if (!attractions.length) {
      return res.status(404).json({ error: "No attractions found for this city" });
    }

    // Increased concurrency for faster processing
    const limit = pLimit(5);
    const BATCH_SIZE = 8;
    const TARGET_RESULTS = 10;

    for (let i = 0; i < attractions.length && results.length < TARGET_RESULTS; i += BATCH_SIZE) {
      const batch = attractions.slice(i, i + BATCH_SIZE);

      const batchTasks = batch.map((attr) =>
        limit(async () => {
          try {
            // Fetch fewer images but faster
            const images = await fetchMultipleImagesForPlace(attr.name, 2);
            if (!images.length) return null;

            return {
              name: attr.name,
              locationName: cityName,
              rating: 4.5,
              latitude: attr.lat,
              longitude: attr.lon,
              images,
              primaryImage: images[0],
              description: null,
              type: attr.tags?.tourism || attr.tags?.historic || attr.tags?.amenity,
              imageCount: images.length,
              mapUrl: createEnhancedGoogleMapsUrl(attr.lat, attr.lon, attr.name),
            };
          } catch (error) {
            return null;
          }
        })
      );

      const batchResults = (await Promise.all(batchTasks)).filter(Boolean);
      results.push(...batchResults);

      // Early exit if we have enough
      if (results.length >= TARGET_RESULTS) break;
    }

    if (!results.length) {
      return res.status(404).json({ error: "No attractions with images found" });
    }

    // Cache the results
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

// Optimized bestPlaceByCityBasic
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

export const getPlaceDeatil = async (req, res) => {
  const { placeName } = req.params;

  if (!placeName || placeName.length < 2) {
    return res.status(400).json({ error: "Invalid place name" });
  }

  try {
    const query = `
      [out:json][timeout:25];
      (
        node["name"="${placeName}"];
        way["name"="${placeName}"];
        relation["name"="${placeName}"];
      );
      out center;
    `;

    const data = await callOverpass(query, 25000);

    if (!data.elements || !data.elements.length) {
      return res.status(404).json({ error: "Place not found in Overpass" });
    }

    const place = data.elements[0];
    const lat = place.lat || place.center?.lat;
    const lon = place.lon || place.center?.lon;
    const tags = place.tags || {};

    const images = await fetchMultipleImagesForPlace(placeName, 5);
    const mapUrl = createEnhancedGoogleMapsUrl(lat, lon, placeName);

    // Fetch Nearby Hotels & Stays (within ~50km if possible, or just same city)
    const city = tags["addr:city"] || tags["is_in:city"];
    const country = tags["addr:country"] || tags["is_in:country"];

    let nearbyHotels = [];
    if (lat && lon) {
      // Basic bounding box search for nearby hotels (+/- 0.5 degrees ~50km)
      nearbyHotels = await hotelModel.find({
        "location.lat": { $gte: lat - 0.5, $lte: lat + 0.5 },
        "location.lng": { $gte: lon - 0.5, $lte: lon + 0.5 }
      }).limit(5).lean();
    }

    const result = {
      name: tags.name || placeName,
      locationName: country || "",
      rating: 4.5, // Default placeholder rating
      description:
        tags.wikipedia ||
        tags.description ||
        tags.tourism ||
        "No description available.",
      latitude: lat,
      longitude: lon,
      type: tags.tourism || tags.amenity || "attraction",
      images,
      primaryImage: images[0] || null,
      imageCount: images.length,
      mapUrl,
      nearbyHotels: nearbyHotels.map(h => ({
        id: h._id,
        name: h.name,
        image: h.images?.[0] || null,
        address: h.address?.street + ", " + h.address?.city + ", " + h.address?.country,
        price: h.discountPrice || h.actualPrice,
        rating: h.averageRating || 4.0
      })),
      rawTags: tags
    };

    return res.json({
      success: true,
      message: "Place detail fetched successfully",
      result,
    });
  } catch (error) {
    console.error("Place detail error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch place detail" });
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

    const hotels = await hotelModel.find({
      "address.city": { $regex: new RegExp(city, "i") },
    });

    return sendSuccess(res, `Hotels found in ${city}`, hotels)

  } catch (error) {
    console.error("Error while fetching hotels by city:", error);
    return sendError(res, "Error while fetching hotels by city", error);
  }
};
