import axios from "axios";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { sendError, sendSuccess } from "../utils/responseUtils.js";
import hotelModel from "../model/hotel.model.js";
import stayModel from "../model/stay.model.js";


const cityCache = new Map();
const attractionsCache = new Map();
const placeDetailCache = new Map();
const imageCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 100;


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


const fetchMultipleImagesForPlace = async (placeName, maxImages = 3) => {
  const cacheKey = `images:${placeName}:${maxImages}`;
  const cached = getCached(imageCache, cacheKey);
  if (cached) return cached;

  try {
    const timeout = 5000;
    const sources = [
      () => fetchBingImage(placeName),
      () => fetchDuckDuckGoImage(placeName),
      () => fetchGoogleImage(placeName)
    ];

    const images = [];


    for (const fetchFn of sources) {
      if (images.length >= maxImages) break;

      try {
        const img = await Promise.race([
          fetchFn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
        ]);

        if (img && img.startsWith('http') && !images.includes(img)) {
          images.push(img);
        }
      } catch (err) {
        continue;
      }
    }

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


const fetchOptimizedImage = async (query) => {
  const images = await fetchMultipleImagesForPlace(query, 1);
  return images.length > 0 ? images[0] : null;
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
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodedName}`;
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


    const hotelCities = await hotelModel.distinct("address.city", { 
      "address.country": { $regex: new RegExp(`^${country}$`, "i") } 
    });
    const allCities = hotelCities.filter(Boolean);


    const cityData = await Promise.all(allCities.map(async (name) => {
      const image = await fetchOptimizedImage(`${name} city ${country} tourism`);
      return { name, image };
    }));

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
        rating: h.averageRating || 0,
        latitude: h.location?.lat,
        longitude: h.location?.lng,
        images: h.images || [],
        primaryImage: h.images?.[0] || null,
        description: h.description,
        isDatabaseEntry: true
      })),
      ...dbStays.map(s => ({
        id: s._id,
        type: "stay",
        name: s.name,
        locationName: s.country || "India",
        cityName: s.city,
        rating: s.rating || 4.5,
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
              rating: 4.5,
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

    const formattedResults = hotels.map(h => ({
      id: h._id,
      type: "hotel",
      name: h.name,
      locationName: h.address?.country || "Global",
      cityName: h.address?.city,
      rating: h.averageRating || 0,
      image: h.images?.[0] || null,
      address: `${h.address?.street || ''}, ${h.address?.city || ''}`.replace(/^, |, $/g, '').trim(),
      price: h.discountPrice || h.actualPrice,
      priceLabel: "Per Night"
    }));

    return sendSuccess(res, `Hotels found in ${city}`, formattedResults);

  } catch (error) {
    console.error("Error while fetching properties by city:", error);
    return sendError(res, "Error while fetching properties by city", error.message);
  }
};

