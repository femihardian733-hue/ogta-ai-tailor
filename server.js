// server.js - Backend utama OGTA AI Tailor
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Konfigurasi upload file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads';
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, atau WEBP.'));
    }
  }
});

// ============================================
// DATA STORAGE (JSON)
// ============================================

// Baca data pricing
const getPricingData = async () => {
  try {
    const data = await fs.readFile('data/pricing.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // Jika file belum ada, buat default
    const defaultPricing = {
      categories: [
        {
          id: 'kebaya',
          name: 'Kebaya',
          setMin: 500000,
          setMax: 800000,
          atasanMin: 200000,
          atasanMax: 400000,
          bawahanMin: 200000,
          bawahanMax: 400000,
          sizes: {
            'S': 0,
            'M': 50000,
            'L': 100000,
            'XL': 150000
          }
        },
        {
          id: 'baju-muslim',
          name: 'Baju Muslim',
          setMin: 200000,
          setMax: 500000,
          atasanMin: 100000,
          atasanMax: 200000,
          bawahanMin: 100000,
          bawahanMax: 200000,
          sizes: {
            'S': 0,
            'M': 50000,
            'L': 100000,
            'XL': 150000
          },
          bonus: ['Gratis 1 Peci']
        },
        {
          id: 'jas',
          name: 'Jas',
          setMin: 700000,
          setMax: 3000000,
          jasMin: 700000,
          jasMax: 2500000,
          rompiMin: 200000,
          rompiMax: 400000,
          celanaMin: 200000,
          celanaMax: 400000,
          sizes: {
            'S': 0,
            'M': 100000,
            'L': 200000,
            'XL': 300000
          }
        },
        {
          id: 'gaun-muslim',
          name: 'Gaun Muslim',
          setMin: 300000,
          setMax: 700000,
          sizes: {
            'S': 0,
            'M': 50000,
            'L': 100000,
            'XL': 150000
          }
        },
        {
          id: 'dress',
          name: 'Dress / Gaun Pesta',
          setMin: 400000,
          setMax: 1000000,
          sizes: {
            'S': 0,
            'M': 75000,
            'L': 150000,
            'XL': 225000
          }
        }
      ],
      bahan: {
        'ogta': {
          name: 'Menggunakan Bahan OGTA',
          markup: 1.2
        },
        'sendiri': {
          name: 'Menggunakan Bahan Sendiri',
          markup: 0.9
        }
      }
    };
    await fs.writeFile('data/pricing.json', JSON.stringify(defaultPricing, null, 2));
    return defaultPricing;
  }
};

// Simpan data pricing
const savePricingData = async (data) => {
  await fs.writeFile('data/pricing.json', JSON.stringify(data, null, 2));
};

// Baca history
const getHistory = async () => {
  try {
    const data = await fs.readFile('data/history.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

// Simpan history
const saveHistory = async (history) => {
  await fs.writeFile('data/history.json', JSON.stringify(history, null, 2));
};

// ============================================
// GEMINI API INTEGRATION
// ============================================

// Fungsi untuk menganalisis gambar dengan Gemini
const analyzeImageWithGemini = async (imagePaths) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro-vision:generateContent?key=${apiKey}`;

    // Buat prompt untuk Gemini
    const prompt = `Anda adalah AI fashion specialist. Analisis gambar pakaian ini dan berikan output dalam format JSON.

Tugas Anda:
1. Identifikasi JENIS pakaian (contoh: Kebaya, Jas, Gaun Pesta, Baju Muslim, Dress, Setelan Formal, dll)
2. Identifikasi DETAIL pakaian (material, aksen, fitur seperti kancing, resleting, payet, dll)
3. Nilai KERUMITAN (Mudah, Sedang, Rumit) berdasarkan detail jahitan
4. Berikan CONFIDENCE score (0-100) untuk analisis Anda

Output HARUS dalam format JSON:
{
  "jenis": "string",
  "detail": ["string", "string", ...],
  "kerumitan": "Mudah/Sedang/Rumit",
  "confidence": 95
}

PENTING:
- JANGAN memberikan harga (biarkan sistem yang menghitung)
- JANGAN memberikan rekomendasi (hanya analisis)
- Jika gambar tidak jelas, gunakan confidence rendah
- Detail harus spesifik dan relevan dengan fashion

Analisis gambar dan berikan JSON valid.`;

    // Siapkan content dengan gambar
    const parts = [{ text: prompt }];
    
    for (const imagePath of imagePaths) {
      const imageData = await fs.readFile(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 
                       path.extname(imagePath).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg';
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Image
        }
      });
    }

    const requestData = {
      contents: [{
        parts: parts
      }]
    };

    const response = await axios.post(url, requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Parse response dari Gemini
    const geminiResponse = response.data;
    let analysisResult = null;
    
    if (geminiResponse.candidates && geminiResponse.candidates.length > 0) {
      const textResponse = geminiResponse.candidates[0].content.parts[0].text;
      // Extract JSON dari response text
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback jika tidak ada JSON
        analysisResult = {
          jenis: 'Tidak Teridentifikasi',
          detail: ['Silakan konsultasikan dengan admin'],
          kerumitan: 'Sedang',
          confidence: 50
        };
      }
    }

    return analysisResult;
  } catch (error) {
    console.error('Error analyzing with Gemini:', error);
    throw new Error('Gagal menganalisis gambar dengan AI');
  }
};

// ============================================
// PRICING ENGINE
// ============================================

// Fungsi menghitung harga berdasarkan AI analysis + data order
const calculatePrice = async (aiAnalysis, orderData) => {
  const pricing = await getPricingData();
  
  // Cari kategori berdasarkan jenis pakaian
  let category = null;
  const jenisLower = aiAnalysis.jenis.toLowerCase();
  
  for (const cat of pricing.categories) {
    if (jenisLower.includes(cat.id) || 
        jenisLower.includes(cat.name.toLowerCase())) {
      category = cat;
      break;
    }
  }

  // Jika tidak ditemukan, gunakan default "Dress"
  if (!category) {
    category = pricing.categories.find(c => c.id === 'dress') || pricing.categories[0];
  }

  // Hitung harga dasar
  let basePrice = 0;
  let isSet = false;

  // Tentukan apakah ini set atau atasan/bawahan
  if (orderData.jenisPakaian.includes('set') || 
      orderData.jenisPakaian.includes('Set') ||
      (aiAnalysis.detail && aiAnalysis.detail.some(d => 
        d.toLowerCase().includes('set') || 
        d.toLowerCase().includes('lengkap')
      ))) {
    isSet = true;
  }

  // Hitung berdasarkan kategori dan tipe
  if (isSet) {
    if (category.setMin && category.setMax) {
      const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8-1.2
      basePrice = category.setMin + ((category.setMax - category.setMin) * randomFactor);
    } else {
      basePrice = (category.setMin + category.setMax) / 2;
    }
  } else {
    // Atasan atau bawahan
    if (orderData.jenisPakaian.toLowerCase().includes('bawahan') ||
        orderData.jenisPakaian.toLowerCase().includes('celana')) {
      if (category.bawahanMin && category.bawahanMax) {
        const randomFactor = 0.8 + (Math.random() * 0.4);
        basePrice = category.bawahanMin + ((category.bawahanMax - category.bawahanMin) * randomFactor);
      } else {
        basePrice = 200000;
      }
    } else {
      // Atasan
      if (category.atasanMin && category.atasanMax) {
        const randomFactor = 0.8 + (Math.random() * 0.4);
        basePrice = category.atasanMin + ((category.atasanMax - category.atasanMin) * randomFactor);
      } else {
        basePrice = 300000;
      }
    }
  }

  // Penyesuaian berdasarkan kerumitan
  const complexityFactor = {
    'Mudah': 0.9,
    'Sedang': 1.0,
    'Rumit': 1.3
  };
  basePrice *= (complexityFactor[aiAnalysis.kerumitan] || 1.0);

  // Penyesuaian berdasarkan ukuran
  const sizeFactor = category.sizes && category.sizes[orderData.ukuran] 
    ? 1 + (category.sizes[orderData.ukuran] / 100000) 
    : 1.0;
  basePrice *= sizeFactor;

  // Penyesuaian berdasarkan bahan
  const bahanMarkup = pricing.bahan[orderData.bahan] 
    ? pricing.bahan[orderData.bahan].markup 
    : 1.0;
  basePrice *= bahanMarkup;

  // Penyesuaian berdasarkan jumlah
  if (orderData.jumlah > 1) {
    const discount = Math.min(0.15, (orderData.jumlah - 1) * 0.05);
    basePrice *= (1 - discount);
  }

  // Bulatkan ke 5000 terdekat
  basePrice = Math.round(basePrice / 5000) * 5000;

  // Pastikan minimal harga
  if (basePrice < 50000) basePrice = 50000;

  // Hitung estimasi waktu (hari)
  let estimatedDays = 7;
  if (aiAnalysis.kerumitan === 'Mudah') estimatedDays = 5;
  else if (aiAnalysis.kerumitan === 'Sedang') estimatedDays = 7;
  else if (aiAnalysis.kerumitan === 'Rumit') estimatedDays = 14;
  
  // Tambahan waktu untuk bahan sendiri
  if (orderData.bahan === 'sendiri') estimatedDays += 2;

  // Bonus
  let bonus = null;
  if (category.bonus && category.bonus.length > 0) {
    bonus = category.bonus;
  }

  return {
    harga: basePrice,
    estimasiHari: estimatedDays,
    bonus: bonus,
    kategori: category.name,
    isSet: isSet
  };
};

// ============================================
// API ROUTES
// ============================================

// 1. Endpoint untuk menganalisis gambar dan menghitung harga
app.post('/api/analyze', upload.array('images', 5), async (req, res) => {
  try {
    const files = req.files;
    const orderData = JSON.parse(req.body.orderData);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Mohon upload minimal 1 gambar' });
    }

    // Analisis gambar dengan Gemini
    const imagePaths = files.map(f => f.path);
    const aiAnalysis = await analyzeImageWithGemini(imagePaths);

    // Hitung harga
    const priceResult = await calculatePrice(aiAnalysis, orderData);

    // Simpan ke history
    const history = await getHistory();
    const newEntry = {
      id: Date.now(),
      tanggal: new Date().toISOString(),
      orderData: orderData,
      aiAnalysis: aiAnalysis,
      priceResult: priceResult,
      images: files.map(f => f.filename)
    };
    history.unshift(newEntry);
    await saveHistory(history);

    // Response
    res.json({
      success: true,
      analysis: aiAnalysis,
      pricing: priceResult,
      orderId: newEntry.id
    });

  } catch (error) {
    console.error('Error in /api/analyze:', error);
    res.status(500).json({ error: error.message || 'Terjadi kesalahan server' });
  }
});

// 2. Endpoint untuk mendapatkan history
app.get('/api/history', async (req, res) => {
  try {
    const history = await getHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil history' });
  }
});

// 3. Endpoint untuk mendapatkan pricing
app.get('/api/pricing', async (req, res) => {
  try {
    const pricing = await getPricingData();
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data pricing' });
  }
});

// 4. Endpoint untuk update pricing (admin only)
app.post('/api/admin/pricing', async (req, res) => {
  try {
    // Verifikasi admin
    const token = req.cookies.adminToken;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const newPricing = req.body;
    await savePricingData(newPricing);
    res.json({ success: true, message: 'Pricing updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update pricing' });
  }
});

// 5. Endpoint login admin
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USERNAME && 
      password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign(
      { username, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.cookie('adminToken', token, { 
      httpOnly: true, 
      maxAge: 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    });
    res.json({ success: true, message: 'Login berhasil' });
  } else {
    res.status(401).json({ error: 'Username atau password salah' });
  }
});

// 6. Endpoint logout admin
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logout berhasil' });
});

// 7. Endpoint export CSV
app.get('/api/admin/export', async (req, res) => {
  try {
    const history = await getHistory();
    
    let csv = 'ID,Tanggal,Jenis Pakaian,Kategori,Ukuran,Bahan,Jumlah,Harga,Confidence\n';
    history.forEach(item => {
      csv += `${item.id},${item.tanggal},${item.aiAnalysis.jenis},${item.pricing.kategori},${item.orderData.ukuran},${item.orderData.bahan},${item.orderData.jumlah},${item.pricing.harga},${item.aiAnalysis.confidence}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=estimations.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Gagal export CSV' });
  }
});

// 8. Endpoint statistik
app.get('/api/admin/stats', async (req, res) => {
  try {
    const history = await getHistory();
    
    const total = history.length;
    const totalRevenue = history.reduce((sum, item) => sum + item.pricing.harga, 0);
    const avgPrice = total > 0 ? totalRevenue / total : 0;
    const categories = {};
    
    history.forEach(item => {
      const cat = item.pricing.kategori;
      if (!categories[cat]) categories[cat] = { count: 0, total: 0 };
      categories[cat].count++;
      categories[cat].total += item.pricing.harga;
    });

    res.json({
      total,
      totalRevenue,
      avgPrice,
      categories
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

// ============================================
// START SERVER
// ============================================

// Buat folder data jika belum ada
fs.ensureDirSync('data');
fs.ensureDirSync('public/uploads');

app.listen(PORT, () => {
  console.log(`🚀 OGTA AI Tailor server running on port ${PORT}`);
  console.log(`📁 Data stored in /data directory`);
  console.log(`🌐 Access at http://localhost:${PORT}`);
});
// ============================================
// ORDER MANAGEMENT
// ============================================

// Baca data orders
const getOrders = async () => {
  try {
    const data = await fs.readFile('data/orders.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // Jika file belum ada, buat default
    const defaultOrders = {
      orders: [],
      metadata: {
        totalOrders: 0,
        totalRevenue: 0,
        lastUpdate: new Date().toISOString()
      }
    };
    await fs.writeFile('data/orders.json', JSON.stringify(defaultOrders, null, 2));
    return defaultOrders;
  }
};

// Simpan data orders
const saveOrders = async (orders) => {
  await fs.writeFile('data/orders.json', JSON.stringify(orders, null, 2));
};

// Tambah order baru
const addOrder = async (orderData) => {
  const orders = await getOrders();
  const newOrder = {
    id: Date.now(),
    orderDate: new Date().toISOString(),
    ...orderData,
    status: 'pending',
    paymentStatus: 'belum',
    notes: ''
  };
  orders.orders.push(newOrder);
  orders.metadata.totalOrders = orders.orders.length;
  orders.metadata.totalRevenue = orders.orders.reduce((sum, order) => sum + order.priceResult.harga, 0);
  orders.metadata.lastUpdate = new Date().toISOString();
  await saveOrders(orders);
  return newOrder;
};

// ============================================
// ENDPOINT TAMBAHAN UNTUK ORDERS
// ============================================

// 9. Endpoint untuk mendapatkan semua orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data orders' });
  }
});

// 10. Endpoint untuk mendapatkan order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const orders = await getOrders();
    const order = orders.orders.find(o => o.id === parseInt(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data order' });
  }
});

// 11. Endpoint untuk update status order
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status, paymentStatus, notes } = req.body;
    const orders = await getOrders();
    const orderIndex = orders.orders.findIndex(o => o.id === parseInt(req.params.id));
    
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    
    if (status) orders.orders[orderIndex].status = status;
    if (paymentStatus) orders.orders[orderIndex].paymentStatus = paymentStatus;
    if (notes !== undefined) orders.orders[orderIndex].notes = notes;
    
    orders.metadata.lastUpdate = new Date().toISOString();
    await saveOrders(orders);
    
    res.json({ success: true, order: orders.orders[orderIndex] });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update status order' });
  }
});

// 12. Endpoint untuk delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const orders = await getOrders();
    const initialLength = orders.orders.length;
    orders.orders = orders.orders.filter(o => o.id !== parseInt(req.params.id));
    
    if (orders.orders.length === initialLength) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    
    orders.metadata.totalOrders = orders.orders.length;
    orders.metadata.totalRevenue = orders.orders.reduce((sum, order) => sum + order.priceResult.harga, 0);
    orders.metadata.lastUpdate = new Date().toISOString();
    await saveOrders(orders);
    
    res.json({ success: true, message: 'Order berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus order' });
  }
});

// 13. Endpoint untuk mendapatkan statistik lengkap (gabungan dari orders dan history)
app.get('/api/admin/full-stats', async (req, res) => {
  try {
    const orders = await getOrders();
    const history = await getHistory();
    
    const stats = {
      totalOrders: orders.metadata.totalOrders,
      totalRevenue: orders.metadata.totalRevenue,
      historyCount: history.length,
      statusDistribution: {},
      paymentDistribution: {}
    };
    
    // Status distribution
    orders.orders.forEach(order => {
      stats.statusDistribution[order.status] = (stats.statusDistribution[order.status] || 0) + 1;
      stats.paymentDistribution[order.paymentStatus] = (stats.paymentDistribution[order.paymentStatus] || 0) + 1;
    });
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});