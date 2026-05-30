# 🍽️ Yemek Analizi Özelliği (Meal Analyzer Feature)

## Özet / Overview

ChefAI uygulamasına yeni bir sekme eklendi: **Yemek Analizi (Meal Analyzer)**. Bu sekme ile kullanıcılar:

- 📸 Yemek fotoğraflarını kamera veya galeriden yükleyebilir
- 🤖 Yapay zeka (OpenAI Vision) tarafından yemek içeriklerini analiz ettirebilir
- 📊 Her bir yemek maddesi için kalori, protein, yağ ve karbonhidrat bilgisini görebilir
- 💾 Analizleri not ve tarih ile kaydedebilir
- 📱 Kaydedilen yemeklerin geçmişini görüntüleyebilir

## Teknik Detaylar / Technical Details

### Frontend Bileşenleri / Frontend Components

**Dosya:** `frontend/app/(tabs)/meal-analyzer.tsx`

- Image picker (camera & gallery)
- OpenAI Vision API entegrasyonu
- AsyncStorage ile token yönetimi
- Çoklu dil desteği (Türkçe/İngilizce)
- Real-time beslenme bilgisi gösterimi
- Kaydedilen yemekler listesi

### Backend API Endpoints

**Route File:** `routes/meals.js`

#### 1. Yemek Analizi
```
POST /api/analyze-meal
Headers: Authorization: Bearer <token>
Body: { image: base64String, language: "tr" | "en" }
Response: { 
  foods: [{ name, calories, protein, fat, carbs }],
  totalCalories, totalProtein, totalFat, totalCarbs 
}
```

#### 2. Yemek Kaydet
```
POST /api/meals
Headers: Authorization: Bearer <token>
Body: {
  image: base64String,
  date: string,
  foods: array,
  totalCalories: number,
  totalProtein: number,
  totalFat: number,
  totalCarbs: number,
  notes: string
}
```

#### 3. Yemekleri Listele
```
GET /api/meals
Headers: Authorization: Bearer <token>
Response: [meal objects]
```

#### 4. Yemek Sil
```
DELETE /api/meals/:id
Headers: Authorization: Bearer <token>
```

#### 5. Yemek Güncelle
```
PUT /api/meals/:id
Headers: Authorization: Bearer <token>
Body: { foods, totalCalories, ... }
```

### Veritabanı Modeli / Database Model

**Dosya:** `models/Meal.js`

```javascript
{
  userId: String,           // Kullanıcı ID
  image: String,            // Base64 encoded image
  date: String,             // Analiz tarihi
  foods: [                  // Yemek maddeleri
    {
      name: String,
      calories: Number,
      protein: Number,
      fat: Number,
      carbs: Number
    }
  ],
  totalCalories: Number,
  totalProtein: Number,
  totalFat: Number,
  totalCarbs: Number,
  notes: String,            // Kullanıcı notları
  createdAt: Date
}
```

## Kurulum / Setup

### Önkoşullar / Prerequisites

1. **OpenAI API Key** - `.env` dosyasında gerekli
   ```
   OPENAI_API_KEY=sk-...
   ```

2. **Environment Variable** (Frontend - `.env.local`)
   ```
   EXPO_PUBLIC_API_URL=https://ai-recipe-production.up.railway.app/api
   ```

### Server Güncellemeleri / Server Updates

1. `server.js` dosyası güncellenmiştir:
   ```javascript
   import { mealRoute } from "./routes/meals.js";
   app.use("/api", mealRoute);
   ```

2. Tüm gerekli paketler halihazırda kurulu:
   - `openai` - OpenAI API
   - `axios` - HTTP requests
   - `mongoose` - MongoDB ORM

## Özellikler / Features

### 1. Görüntü Yükleme
- Kameradan fotoğraf çekim
- Galeriden fotoğraf seçim
- Base64 encoding otomatik

### 2. AI Analizi
- OpenAI gpt-4-turbo Vision API kullanır
- Türkçe/İngilizce destekli prompt
- Otomatik kalori ve makro tahminleri

### 3. Beslenme Bilgisi
Her yemek için gösterilen:
- 🔥 Kalori (kcal)
- 💪 Protein (g)
- 🧈 Yağ (g)
- 🍞 Karbonhidrat (g)

### 4. Kayıt ve Yönetim
- Yemek adı ve notlar ile kayıt
- Tarih bilgisi otomatik
- Kolay silme işlemi
- Yemek geçmişi görüntüleme

## Kullanım Rehberi / Usage Guide

### Kullanıcı Akışı

1. **Sekmeye Git** → "Analiz" veya "Yemek Analizi" sekmesini aç
2. **Fotoğraf Yükle** → Kamera/Galeri'den fotoğraf seç
3. **AI Analiz** → Otomatik analiz yapılacak (15-30 saniye)
4. **Sonuçları Gözlemle** → Beslenme bilgisini kontrolle
5. **Kaydet** → Yemek adı gir ve "Kaydet"e tıkla
6. **Geçmişe Bakın** → "Kaydedilen Yemekler"den view al

### Örnek Prompt (Türkçe)

```
Verilen yemek fotoğrafını analiz et ve aşağıdaki JSON formatında yanıt ver:

{
  "foods": [
    {
      "name": "yemek adı (Türkçe)",
      "calories": kalori sayısı,
      "protein": protein gram,
      "fat": yağ gram,
      "carbs": karbonhidrat gram
    }
  ],
  "totalCalories": toplam kalori,
  "totalProtein": toplam protein gram,
  "totalFat": toplam yağ gram,
  "totalCarbs": toplam karbonhidrat gram
}
```

## Hata Giderme / Troubleshooting

### "Token yok" Hatası
- Kullanıcı giriş yapmadığını kontrol et
- AsyncStorage'dan token alınamıyor olabilir

### "Analiz başarısız" Hatası
- OpenAI API key'i kontrol et
- İnternet bağlantısını kontrol et
- Görüntü boyutunu kontrol et (çok büyük olabilir)

### "Yemek bulunamadı" Hatası
- MongoDB bağlantısı kontrol et
- userId'nin doğru olduğundan emin ol

### Görüntü Kaydedilmiyor
- Base64 encoding durumunu kontrol et
- Veritabanı depolama limitini kontrol et

## Geliştirmeler / Future Improvements

- [ ] Cloud storage (Firebase/S3) entegrasyonu
- [ ] Beslenme hedefleri ile takip etme
- [ ] Haftalık rapor üretme
- [ ] Favori yemekler özelliği
- [ ] Barcode scanner entegrasyonu
- [ ] Export (PDF/CSV) özelliği
- [ ] Beslenmen danışman önerileri

## İlgili Dosyalar / Related Files

- Frontend: `frontend/app/(tabs)/meal-analyzer.tsx`
- Tabs Layout: `frontend/app/(tabs)/_layout.tsx`
- Backend Routes: `routes/meals.js`
- Data Model: `models/Meal.js`
- Server Config: `server.js`

## API İstatistikleri / API Statistics

- **Model**: gpt-4-turbo
- **Vision Capability**: Evet
- **Max Tokens**: 1024
- **Timeout**: 60 saniye
- **Base64 Image Format**: Desteklendi

---

**Version:** 1.0  
**Last Updated:** May 2026  
**Language:** TR/EN
