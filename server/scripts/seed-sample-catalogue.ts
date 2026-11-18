import { connectDatabase, disconnectDatabase } from '../src/database.js'
import { DailyPrice } from '../src/modules/pricing/daily-price.model.js'
import { Product } from '../src/modules/products/product.model.js'
import { Stock } from '../src/modules/inventory/stock.model.js'
import { loadConfig } from '../src/config.js'

const samples = [
  {
    slug: 'white-prawns',
    name: 'White Prawns',
    size: 'Medium',
    origin: 'Coastal catch',
    badge: 'BESTSELLER',
    description: 'Sweet, juicy and wonderfully versatile.',
    longDescription: 'A dependable favourite for weeknight curries, golden fry-ups and everything in between. Cleaned by hand if you like, or left just as nature intended.',
    imageUrl: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=900&q=85',
    pricePerKgPaise: 68000,
    cleaningFeePaise: 4000,
    onHandGrams: 12500,
  },
  {
    slug: 'tiger-prawns',
    name: 'Tiger Prawns',
    size: 'Large',
    origin: 'Coastal catch',
    badge: 'A LITTLE EXTRA',
    description: 'Meaty, bold and made for the grill.',
    longDescription: 'Big, beautiful and full of flavour. These meaty prawns love a hot pan, a little chilli and a squeeze of lime. Ask us to clean them and they’re ready to cook.',
    imageUrl: 'https://images.unsplash.com/photo-1625944525533-473f1a3d54e7?auto=format&fit=crop&w=900&q=85',
    pricePerKgPaise: 92000,
    cleaningFeePaise: 5000,
    onHandGrams: 8000,
  },
  {
    slug: 'small-prawns',
    name: 'Small Prawns',
    size: 'Small',
    origin: 'Coastal catch',
    badge: 'CURRY FAVOURITE',
    description: 'Little gems for a big bowl of curry.',
    longDescription: 'Small in size, generous in flavour. A much-loved choice for Andhra-style prawn curry, stir-fries and your family’s favourite recipes.',
    imageUrl: 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?auto=format&fit=crop&w=900&q=85',
    pricePerKgPaise: 52000,
    cleaningFeePaise: 3500,
    onHandGrams: 2000,
  },
  {
    slug: 'jumbo-prawns',
    name: 'Jumbo Prawns',
    size: 'Large',
    origin: 'Coastal catch',
    badge: 'SPECIAL PICK',
    description: 'A showstopper for special occasions.',
    longDescription: 'The kind of prawns that turn dinner into an occasion. Plump, satisfying and lovely with a simple marinade, they make every plate feel special.',
    imageUrl: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?auto=format&fit=crop&w=900&q=85',
    pricePerKgPaise: 110000,
    cleaningFeePaise: 6000,
    onHandGrams: 6500,
  },
]

function hyderabadDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value
  const localDate = `${part('year')}-${part('month')}-${part('day')}`
  return new Date(`${localDate}T00:00:00+05:30`)
}

async function seed(): Promise<void> {
  const config = loadConfig()
  const databaseHost = new URL(config.MONGODB_URI).hostname.replace(/^\[|\]$/g, '')
  if (config.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    throw new Error('Sample data seeding is restricted to development using a local MongoDB host')
  }

  await connectDatabase(config.MONGODB_URI)
  try {
    const effectiveFrom = hyderabadDayStart(new Date())
    const effectiveTo = new Date(effectiveFrom.getTime() + 24 * 60 * 60 * 1000)

    for (const sample of samples) {
      const {
        pricePerKgPaise,
        cleaningFeePaise,
        onHandGrams,
        ...productFields
      } = sample
      const product = await Product.findOneAndUpdate(
        { slug: productFields.slug },
        {
          $set: {
            ...productFields,
            active: true,
            sampleData: true,
            preparationOptions: [
              { type: 'cleaned', enabled: true, feePaise: cleaningFeePaise },
              { type: 'uncleaned', enabled: true, feePaise: 0 },
            ],
          },
        },
        { upsert: true, new: true, runValidators: true },
      )

      await Promise.all([
        DailyPrice.findOneAndUpdate(
          { productId: product._id, effectiveFrom },
          { $set: { pricePerKgPaise, effectiveTo } },
          { upsert: true, new: true, runValidators: true },
        ),
        Stock.findOneAndUpdate(
          { productId: product._id },
          { $set: { onHandGrams, reservedGrams: 0 } },
          { upsert: true, new: true, runValidators: true },
        ),
      ])
    }

    console.info(`Seeded ${samples.length} clearly marked sample products and today's sample prices/stock.`)
  } finally {
    await disconnectDatabase()
  }
}

await seed()
