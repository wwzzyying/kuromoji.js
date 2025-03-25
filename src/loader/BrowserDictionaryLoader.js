/*
 * Copyright 2014 Takuya Asano
 * Copyright 2010-2014 Atilika Inc. and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const fflate = require('fflate');
const DictionaryLoader = require('./DictionaryLoader');

const DB_CONFIG = {
  name: 'kuromojiDB',
  store: 'dictionary',
  version: 1,
};

let db = null;
let dbInitPromise = null;

// Initialize IndexedDB
const initDB = () => {
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }

    console.log('Initializing IndexedDB...');
    console.log('IndexedDB support check:', 'indexedDB' in window);
    console.log('Current protocol:', window.location.protocol);
    console.log('Current host:', window.location.host);
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

    request.onerror = (event) => {
      console.error('Failed to open IndexedDB:', event.target.error);
      db = null;
      resolve(null);
    };

    request.onsuccess = (event) => {
      console.log('IndexedDB initialized successfully');
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      console.log('Upgrading IndexedDB...');
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
        db.createObjectStore(DB_CONFIG.store, { keyPath: 'url' });
      }
    };
  });

  return dbInitPromise;
};

// Get data from cache
const getFromCache = async (url) => {
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(DB_CONFIG.store, 'readonly');
      const store = transaction.objectStore(DB_CONFIG.store);
      const request = store.get(url);

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.decompressedData) {
          resolve(result.decompressedData);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    } catch (error) {
      console.error('Error reading from cache:', error);
      resolve(null);
    }
  });
};

// Save data to cache
const saveToCache = async (url, decompressedData) => {
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(DB_CONFIG.store, 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.store);
      const request = store.put({
        url,
        decompressedData,
        timestamp: Date.now(),
      });

      request.onsuccess = () => {
        console.log(`Cached decompressed data for: ${url}`);
        resolve(true);
      };
      request.onerror = () => resolve(false);
    } catch (error) {
      console.error('Error saving to cache:', error);
      resolve(false);
    }
  });
};

// Fetch data from network
const fetchFromNetwork = async (url) => {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(response.statusText);

    const arraybuffer = await response.arrayBuffer();
    const decompressed = fflate.gunzipSync(new Uint8Array(arraybuffer));
    return decompressed.buffer;
  } catch (error) {
    throw error;
  }
};

function BrowserDictionaryLoader(dic_path) {
  DictionaryLoader.apply(this, [dic_path]);
}

BrowserDictionaryLoader.prototype = Object.create(DictionaryLoader.prototype);

BrowserDictionaryLoader.prototype.loadArrayBuffer = function (url, callback) {
  const loadData = async () => {
    try {
      // Ensure IndexedDB initialization is complete
      await initDB();

      console.log('Loading data from:', url);

      // If IndexedDB is available, try to get from cache first
      if (db) {
        const cachedData = await getFromCache(url);
        if (cachedData) {
          console.log('Cache hit for:', url);
          callback(null, cachedData);
          return;
        }
        console.log('Cache miss for:', url);
      }

      // Fetch and decompress from network
      console.log('Fetching from network:', url);
      const decompressedBuffer = await fetchFromNetwork(url);

      // If IndexedDB is available, save decompressed data to cache
      if (db) {
        console.log('Saving decompressed data to cache:', url);
        await saveToCache(url, decompressedBuffer);
      }

      callback(null, decompressedBuffer);
    } catch (error) {
      console.error('Error loading dictionary:', error);
      callback(error, null);
    }
  };

  loadData();
};

module.exports = BrowserDictionaryLoader;
