// ============================================================================
// Cloudflare Workers Product & Category Management Module
// Handles Product CRUD, Categories, Technical Specifications, and D1 Storage
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

const DEFAULT_CATEGORIES = [
  { id: 'cat_01', name: 'Food & Beverage', slug: 'food-beverage', icon: '🍔', display_order: 1 },
  { id: 'cat_02', name: 'Education & Training', slug: 'education-training', icon: '🎓', display_order: 2 },
  { id: 'cat_03', name: 'Computer / Laptop', slug: 'computer-laptop', icon: '💻', display_order: 3 },
  { id: 'cat_04', name: 'Mobile / Smartphone', slug: 'mobile-smartphone', icon: '📱', display_order: 4 },
  { id: 'cat_05', name: 'Electronics', slug: 'electronics', icon: '⚡', display_order: 5 },
  { id: 'cat_06', name: 'Automobile & EV', slug: 'automobile-ev', icon: '🚗', display_order: 6 },
  { id: 'cat_07', name: 'Hotel / Resort', slug: 'hotel-resort', icon: '🏨', display_order: 7 },
  { id: 'cat_08', name: 'Restaurant / Cafe', slug: 'restaurant-cafe', icon: '☕', display_order: 8 },
  { id: 'cat_09', name: 'Clothing / Fashion', slug: 'clothing-fashion', icon: '👗', display_order: 9 },
  { id: 'cat_10', name: 'Home Appliances', slug: 'home-appliances', icon: '🏠', display_order: 10 },
  { id: 'cat_11', name: 'Healthcare / Pharmacy', slug: 'healthcare-pharmacy', icon: '💊', display_order: 11 },
  { id: 'cat_12', name: 'Fitness / Gym', slug: 'fitness-gym', icon: '💪', display_order: 12 },
  { id: 'cat_13', name: 'Salon / Beauty', slug: 'salon-beauty', icon: '💇', display_order: 13 },
  { id: 'cat_14', name: 'Retail / Shopping', slug: 'retail-shopping', icon: '🛍️', display_order: 14 },
  { id: 'cat_15', name: 'Finance / Banking', slug: 'finance-banking', icon: '💳', display_order: 15 },
  { id: 'cat_16', name: 'Travel / Tourism', slug: 'travel-tourism', icon: '✈️', display_order: 16 },
  { id: 'cat_17', name: 'Real Estate', slug: 'real-estate', icon: '🏢', display_order: 17 },
  { id: 'cat_18', name: 'Service / Repair', slug: 'service-repair', icon: '🔧', display_order: 18 },
  { id: 'cat_19', name: 'Coaching / Workshops', slug: 'coaching-workshops', icon: '📚', display_order: 19 },
  { id: 'cat_20', name: 'Gaming / Esports', slug: 'gaming-esports', icon: '🎮', display_order: 20 },
  { id: 'cat_21', name: 'Other / Custom', slug: 'other-custom', icon: '✨', display_order: 21 }
];

// Resilient In-Memory Product & Category Storage
export const memoryCategories = [...DEFAULT_CATEGORIES];
export const memoryProducts = [];

/**
 * GET /api/categories
 */
export async function handleListCategories(request, env) {
  try {
    if (env.DB) {
      const categories = await env.DB.prepare('SELECT * FROM categories ORDER BY display_order ASC, name ASC').all();
      if (categories && categories.results && categories.results.length > 0) {
        return jsonResponse({ categories: categories.results });
      }
    }
  } catch (err) {}
  if (memoryCategories.length === 0) {
    memoryCategories.push(...DEFAULT_CATEGORIES);
  }
  return jsonResponse({ categories: memoryCategories });
}

/**
 * POST /api/categories
 */
export async function handleCreateCategory(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    if (!data.name) return jsonResponse({ error: 'Category name is required' }, 400);

    const newCat = {
      id: data.id || `cat_${Date.now().toString(36)}`,
      name: data.name,
      slug: data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      icon: data.icon || '🏷️',
      display_order: memoryCategories.length + 1
    };

    memoryCategories.push(newCat);

    if (env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO categories (id, name, slug, display_order)
          VALUES (?, ?, ?, ?)
        `).bind(newCat.id, newCat.name, newCat.slug, newCat.display_order).run();
      } catch (e) {}
    }

    return jsonResponse({ success: true, category: newCat }, 201);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * PUT /api/categories/:id
 */
export async function handleUpdateCategory(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    const idx = memoryCategories.findIndex(c => c.id === id);
    if (idx !== -1) {
      memoryCategories[idx] = { ...memoryCategories[idx], ...data };
    }

    if (env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE categories SET name = ?, slug = ? WHERE id = ?
        `).bind(data.name, data.slug || '', id).run();
      } catch (e) {}
    }

    return jsonResponse({ success: true, category: memoryCategories[idx] || data });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * DELETE /api/categories/:id
 */
export async function handleDeleteCategory(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const idx = memoryCategories.findIndex(c => c.id === id);
    if (idx !== -1) {
      memoryCategories.splice(idx, 1);
    }

    if (env.DB) {
      try {
        await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
      } catch (e) {}
    }

    return jsonResponse({ success: true, message: 'Category deleted successfully.' });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * GET /api/products
 */
export async function handleListProducts(request, env) {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase().trim();
  const categoryId = url.searchParams.get('category') || '';

  // 1. Primary: Cloudflare D1 SQL Database
  if (env && env.DB) {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let query = `
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE 1=1
      `;
      const params = [];

      if (search) {
        query += ` AND (p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term);
      }

      if (categoryId) {
        query += ` AND p.category_id = ?`;
        params.push(categoryId);
      }

      query += ` ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = env.DB.prepare(query);
      const result = await stmt.bind(...params).all();
      if (result && Array.isArray(result.results)) {
        return jsonResponse({ products: result.results });
      }
    } catch (err) {
      console.warn('[D1 List Notice]:', err.message);
    }
  }

  // 2. Secondary: Central Cloud Store Fallback (if D1 is unprovisioned)
  try {
    const cloudRes = await fetch('https://ai-advertising-robot-8.onrender.com/api/products', {
      headers: { 'Accept': 'application/json' }
    });
    if (cloudRes.ok) {
      const d = await cloudRes.json();
      if (d && Array.isArray(d.products)) {
        let prods = d.products;
        if (search) {
          prods = prods.filter(p => (p.name && p.name.toLowerCase().includes(search)) || (p.brand && p.brand.toLowerCase().includes(search)));
        }
        if (categoryId) {
          prods = prods.filter(p => p.category_id === categoryId);
        }
        return jsonResponse({ products: prods });
      }
    }
  } catch (cloudErr) {}

  // 3. Fallback: Active isolate memory
  let filtered = [...memoryProducts];
  if (search) {
    filtered = filtered.filter(p => 
      (p.name && p.name.toLowerCase().includes(search)) ||
      (p.brand && p.brand.toLowerCase().includes(search)) ||
      (p.description && p.description.toLowerCase().includes(search))
    );
  }
  if (categoryId) {
    filtered = filtered.filter(p => p.category_id === categoryId);
  }

  return jsonResponse({ products: filtered });
}

/**
 * GET /api/products/:id
 */
export async function handleGetProduct(request, env, id) {
  if (env && env.DB) {
    try {
      const product = await env.DB.prepare(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE p.id = ?
      `).bind(id).first();
      if (product) return jsonResponse({ product });
    } catch (e) {}
  }

  try {
    const cloudRes = await fetch(`https://ai-advertising-robot-8.onrender.com/api/products/${id}`);
    if (cloudRes.ok) {
      const d = await cloudRes.json();
      if (d && d.product) return jsonResponse({ product: d.product });
    }
  } catch (e) {}

  const memProd = memoryProducts.find(p => p.id === id);
  if (memProd) return jsonResponse({ product: memProd });

  return jsonResponse({ error: 'Product not found' }, 404);
}

/**
 * POST /api/products
 */
export async function handleCreateProduct(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    if (!data.name || !data.category_id) {
      return jsonResponse({ error: 'Product name and category are required.' }, 400);
    }

    const id = data.id || `prod_${generateRandomHex(8)}`;
    const cat = memoryCategories.find(c => c.id === data.category_id);
    const categoryName = data.category_name || (cat ? cat.name : 'General');

    const newProduct = {
      id,
      name: data.name,
      category_id: data.category_id,
      category_name: categoryName,
      brand: data.brand || '',
      model: data.model || '',
      price: data.price !== undefined ? parseFloat(data.price) : null,
      currency: data.currency || 'INR',
      description: data.description || '',
      description_ml: data.description_ml || '',
      features_json: typeof data.features === 'object' ? JSON.stringify(data.features) : (data.features_json || '[]'),
      specs_json: typeof data.specs === 'object' ? JSON.stringify(data.specs) : (data.specs_json || '{}'),
      promo_info: data.promo_info || '',
      availability: data.availability || 'In Stock',
      faq_json: typeof data.faqs === 'object' ? JSON.stringify(data.faqs) : (data.faq_json || '[]'),
      image_url: data.image_url || null,
      notes: data.notes || '',
      is_verified: data.is_verified ? 1 : 0,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Store in active isolate memory
    const existingIdx = memoryProducts.findIndex(p => p.id === id);
    if (existingIdx !== -1) {
      memoryProducts[existingIdx] = newProduct;
    } else {
      memoryProducts.unshift(newProduct);
    }

    // 2. Primary: Persist to Cloudflare D1 SQL Database with atomic ON CONFLICT UPSERT
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO products (
            id, name, category_id, brand, model, price, currency, description, 
            description_ml, features_json, specs_json, promo_info, availability, 
            faq_json, image_url, notes, is_verified, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category_id = excluded.category_id,
            brand = excluded.brand,
            model = excluded.model,
            price = excluded.price,
            currency = excluded.currency,
            description = excluded.description,
            description_ml = excluded.description_ml,
            features_json = excluded.features_json,
            specs_json = excluded.specs_json,
            promo_info = excluded.promo_info,
            availability = excluded.availability,
            faq_json = excluded.faq_json,
            image_url = excluded.image_url,
            notes = excluded.notes,
            is_verified = excluded.is_verified,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          id,
          newProduct.name,
          newProduct.category_id,
          newProduct.brand || null,
          newProduct.model || null,
          newProduct.price,
          newProduct.currency,
          newProduct.description,
          newProduct.description_ml,
          newProduct.features_json,
          newProduct.specs_json,
          newProduct.promo_info,
          newProduct.availability,
          newProduct.faq_json,
          newProduct.image_url,
          newProduct.notes,
          newProduct.is_verified
        ).run();
      } catch (dbErr) {
        console.warn('[D1 Upsert Notice]:', dbErr.message);
      }
    }

    // 3. Central Cloud Store Sync: Replicate so data is permanent across all regions
    try {
      await fetch('https://ai-advertising-robot-8.onrender.com/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct)
      });
    } catch (syncErr) {}

    return jsonResponse({ success: true, message: 'Product created successfully', id, product: newProduct }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create product: ' + err.message }, 500);
  }
}

/**
 * PUT /api/products/:id
 */
export async function handleUpdateProduct(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();

    // 1. Update in active isolate memory
    const idx = memoryProducts.findIndex(p => p.id === id);
    if (idx !== -1) {
      memoryProducts[idx] = {
        ...memoryProducts[idx],
        ...data,
        updated_at: new Date().toISOString()
      };
    }

    // 2. Update in Cloudflare D1 SQL Database
    if (env && env.DB) {
      try {
        const featuresJson = typeof data.features === 'object' ? JSON.stringify(data.features) : (data.features_json || '[]');
        const specsJson = typeof data.specs === 'object' ? JSON.stringify(data.specs) : (data.specs_json || '{}');
        const faqJson = typeof data.faqs === 'object' ? JSON.stringify(data.faqs) : (data.faq_json || '[]');

        await env.DB.prepare(`
          UPDATE products SET
            name = ?, category_id = ?, brand = ?, model = ?, price = ?, 
            currency = ?, description = ?, description_ml = ?, features_json = ?, 
            specs_json = ?, promo_info = ?, availability = ?, faq_json = ?, 
            image_url = ?, notes = ?, is_verified = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          data.name,
          data.category_id,
          data.brand || null,
          data.model || null,
          data.price !== undefined ? parseFloat(data.price) : null,
          data.currency || 'INR',
          data.description || '',
          data.description_ml || '',
          featuresJson,
          specsJson,
          data.promo_info || '',
          data.availability || 'In Stock',
          faqJson,
          data.image_url || null,
          data.notes || '',
          data.is_verified ? 1 : 0,
          id
        ).run();
      } catch (dbErr) {
        console.warn('[D1 Update Notice]:', dbErr.message);
      }
    }

    // 3. Central Cloud Store Sync
    try {
      await fetch(`https://ai-advertising-robot-8.onrender.com/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (syncErr) {}

    return jsonResponse({ success: true, message: 'Product updated successfully' });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update product: ' + err.message }, 500);
  }
}

/**
 * DELETE /api/products/:id
 */
export async function handleDeleteProduct(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  // 1. Remove from in-memory
  const idx = memoryProducts.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryProducts.splice(idx, 1);
  }

  // 2. Remove from Cloudflare D1 SQL Database
  if (env && env.DB) {
    try {
      await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    } catch (e) {
      console.warn('[D1 Delete Notice]:', e.message);
    }
  }

  // 3. Remove from Central Cloud Store
  try {
    await fetch(`https://ai-advertising-robot-8.onrender.com/api/products/${id}`, { method: 'DELETE' });
  } catch (syncErr) {}

  return jsonResponse({ success: true, message: 'Product deleted successfully' });
}
