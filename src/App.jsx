import { Component, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, Check, Clock3,
  Fish, Headset, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal,
  Sparkles, Truck, X,
} from 'lucide-react'
import { buildDeliveryAssignmentPayload, deliveryStatusLabel, toCustomerDelivery } from './delivery.js'
import { parseStockDelta, rupeesToPaise } from './admin.js'
import { toPaymentDisplay } from './payment-display.js'
import './App.css'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
let latestAccessToken = ''
let authStateUpdater = () => {}
let refreshInFlight = null
let googleIdentityPromise = null
let googleConfiguredClientId = ''
let googleCredentialHandler = null

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  if (!googleIdentityPromise) {
    googleIdentityPromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-google-identity]')
      if (!script) {
        script = document.createElement('script')
        script.dataset.googleIdentity = 'true'
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.defer = true
      }
      script.addEventListener('load', () => {
        if (window.google?.accounts?.id) resolve(window.google)
        else reject(new Error('Google sign-in did not load.'))
      }, { once: true })
      script.addEventListener('error', () => {
        script.remove()
        reject(new Error('Google sign-in could not be loaded.'))
      }, { once: true })
      if (!script.isConnected) document.head.append(script)
    }).catch((error) => {
      googleIdentityPromise = null
      throw error
    })
  }
  return googleIdentityPromise
}
function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${apiBase}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.data?.accessToken) {
          if (response.status === 401) {
            latestAccessToken = ''
            authStateUpdater(null)
          }
          throw new Error(payload?.error?.message || `Session refresh failed (${response.status}).`)
        }
        latestAccessToken = payload.data.accessToken
        authStateUpdater(payload.data)
        return payload.data
      })
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}
const money = (amount) => `₹${Math.round(amount).toLocaleString('en-IN')}`
const deliveryFee = 40
const formatWeight = (grams) => grams >= 1000
  ? `${(grams / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg`
  : `${grams.toLocaleString('en-IN')} g`

async function apiRequest(path, { token, ...options } = {}) {
  const requestWithToken = (accessToken) => {
    const headers = new Headers(options.headers || {})
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(`${apiBase}${path}`, { ...options, headers, credentials: 'include' })
  }
  const initialToken = latestAccessToken || token
  let response = await requestWithToken(initialToken)
  if (response.status === 401 && initialToken && path !== '/api/v1/auth/refresh') {
    const refreshed = await refreshSession()
    response = await requestWithToken(refreshed.accessToken)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status}).`)
  return payload
}

function toAdminOrder(order) {
  const statusLabels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    preparing: 'Processing',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  }
  const displayId = `FP-${order.id.slice(-6).toUpperCase()}`
  return {
    ...order,
    rawId: order.id,
    id: displayId,
    status: statusLabels[order.status] || order.status,
    rawStatus: order.status,
    customer: order.customerName,
    phone: order.customerPhone,
    time: new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    total: order.totalPaise / 100,
    address: `${order.address.line}, ${order.address.locality}, ${order.address.city} ${order.address.postalCode}`,
    deliveryMethod: order.deliveryMethod === 'third_party' ? 'partner' : 'shop',
    delivery: order.deliveryAssignment || { method: order.deliveryMethod, status: 'not_assigned' },
    ...toPaymentDisplay(order),
    items: order.items.map((item) => ({
      name: item.productName,
      detail: `${item.preparation} · ${formatWeight(item.weightGrams)} × ${item.quantity}`,
      price: item.lineTotalPaise / 100,
    })),
  }
}

function toCustomerOrder(order) {
  return {
    id: `FP-${order.id.slice(-6).toUpperCase()}`,
    orderId: order.id,
    name: order.customerName,
    address: `${order.address.line}, ${order.address.locality}, ${order.address.city} ${order.address.postalCode}`,
    deliveryMethod: order.deliveryMethod === 'third_party' ? 'partner' : 'shop',
    delivery: toCustomerDelivery(order.deliveryAssignment, order.deliveryMethod),
    ...toPaymentDisplay(order),
    status: order.status,
    total: order.totalPaise / 100,
    createdAt: new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function toStoreProduct(item) {
  const cleanedOption = item.preparationOptions.find((option) => option.type === 'cleaned')
  return {
    ...item,
    pricePerKg: item.pricePerKgPaise === null ? null : item.pricePerKgPaise / 100,
    cleaningFee: (cleanedOption?.feePaise || 0) / 100,
    stockKg: item.stock.availableGrams / 1000,
    availableGrams: item.stock.availableGrams,
    preparationOptions: item.preparationOptions || [],
    image: item.imageUrl || '',
  }
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="page-main">
          <div className="empty-state" role="alert">
            <Fish size={34} />
            <h1>Something went wrong</h1>
            <p>Reload the page to try again. If the problem continues, contact the shop.</p>
            <button className="button button-outline" type="button" onClick={() => this.setState({ hasError: false })}>
              Try again
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

function App() {
  const [products, setProducts] = useState([])
  const [catalogueStatus, setCatalogueStatus] = useState('loading')
  const [catalogueError, setCatalogueError] = useState('')
  const [catalogueRetry, setCatalogueRetry] = useState(0)
  const [cart, setCart] = useState([])
  const [activeOrder, setActiveOrder] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [authToken, setAuthToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')

  useEffect(() => {
    authStateUpdater = (data) => {
      latestAccessToken = data?.accessToken || ''
      setAuthToken(latestAccessToken)
      setCurrentUser(data?.user || null)
    }
    return () => { authStateUpdater = () => {} }
  }, [])

  useEffect(() => {
    let active = true
    refreshSession()
      .then(() => {
        if (!active) return
        setAuthStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setAuthStatus('ready')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiBase}/api/v1/products`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error?.message || `Product service unavailable (${response.status}).`)
        if (!Array.isArray(payload?.data)) throw new Error('Product service returned an invalid catalogue response.')
        return payload.data.map(toStoreProduct)
      })
      .then((items) => {
        setProducts(items)
        setCatalogueStatus('ready')
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        setCatalogueError(error instanceof TypeError
          ? 'We could not load the catalogue. Check your connection and try again.'
          : error.message || 'The product catalogue is temporarily unavailable.')
        setCatalogueStatus('error')
      })

    return () => controller.abort()
  }, [catalogueRetry])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const addToCart = (product, cleaned, weight, quantity = 1) => {
    const option = product.preparationOptions.find((item) => item.type === (cleaned ? 'cleaned' : 'uncleaned'))
    if (
      product.pricePerKg === null
      || !option?.enabled
      || product.availableGrams < weight * quantity
    ) {
      setToast({ message: 'This selection is no longer available', showCartLink: false })
      return
    }
    const key = `${product.id}-${cleaned ? 'cleaned' : 'whole'}-${weight}`
    setCart((items) => {
      const found = items.find((item) => item.key === key)
      if (found) return items.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      return [...items, { key, productId: product.id, cleaned, weight, quantity }]
    })
    setToast({ message: `${product.name} added to cart`, showCartLink: true })
  }

  const updateQuantity = (key, change) => setCart((items) => items
    .map((item) => {
      if (item.key !== key) return item
      const product = products.find((entry) => entry.id === item.productId)
      const availableQuantity = product ? Math.floor(product.availableGrams / item.weight) : 0
      return { ...item, quantity: Math.max(0, Math.min(availableQuantity, item.quantity + change)) }
    })
    .filter((item) => item.quantity > 0))

  const clearCart = () => setCart([])
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0)

  const retryCatalogue = () => {
    setCatalogueError('')
    setCatalogueStatus('loading')
    setCatalogueRetry((attempt) => attempt + 1)
  }

  const onAuthenticated = ({ user, accessToken }) => {
    latestAccessToken = accessToken
    authStateUpdater({ user, accessToken })
  }

  const signOut = async () => {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' })
      latestAccessToken = ''
      authStateUpdater(null)
    } catch (error) {
      setToast({ message: error.message || 'Could not sign out. Please try again.', showCartLink: false })
    }
  }

  return (
    <BrowserRouter>
      <div className="app-shell min-h-screen">
        <Header cartCount={cartCount} menuOpen={menuOpen} setMenuOpen={setMenuOpen} currentUser={currentUser} />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<HomePage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
            <Route path="/shop" element={<ShopPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
            <Route path="/product/:id" element={<ProductPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
            <Route path="/cart" element={<CartPage cart={cart} products={products} onChange={updateQuantity} />} />
            <Route path="/account" element={<AccountPage currentUser={currentUser} authStatus={authStatus} onAuthenticated={onAuthenticated} onSignOut={signOut} />} />
            <Route path="/checkout" element={<CheckoutPage cart={cart} products={products} currentUser={currentUser} authToken={authToken} onPlaceOrder={(order) => { setActiveOrder(order); clearCart() }} />} />
            <Route path="/track" element={<TrackPage order={activeOrder} authToken={authToken} currentUser={currentUser} />} />
            <Route path="/admin/*" element={<AdminPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} currentUser={currentUser} authToken={authToken} authStatus={authStatus} onSignOut={signOut} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
        <Footer />
        {toast && <div className="cart-toast" role="status" aria-live="polite"><span className="cart-toast-check"><Check size={16} /></span><span>{toast.message}</span>{toast.showCartLink && <Link to="/cart" onClick={() => setToast(null)}>View cart</Link>}<button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
      </div>
    </BrowserRouter>
  )
}

function Header({ cartCount, menuOpen, setMenuOpen, currentUser }) {
  const closeMenu = () => setMenuOpen(false)
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="Fresh Prawns Online home" onClick={closeMenu}>
          <span className="brand-mark"><Fish size={23} strokeWidth={2.2} /></span>
          <span className="brand-name">fresh<span>prawns</span><small>ONLINE · HYDERABAD</small></span>
        </Link>
        <button className="mobile-menu" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <NavLink to="/" end onClick={closeMenu}>Home</NavLink>
          <NavLink to="/shop" onClick={closeMenu}>Shop prawns</NavLink>
          <a href="/#our-promise" onClick={closeMenu}>Our promise</a>
          <a href="/#contact" onClick={closeMenu}>Contact</a>
        </nav>
        <div className="header-actions">
          <Link className="track-link" to="/track"><PackageCheck size={17} /> {currentUser?.role === 'customer' ? 'Track orders' : 'Track order'}</Link>
          <Link className="track-link account-nav" to="/account">{currentUser ? 'My account' : 'Sign in'}</Link>
          <Link to="/cart" className="cart-button" aria-label={`Cart, ${cartCount} items`}><ShoppingBag size={18} /><span>Cart</span><b>{cartCount}</b></Link>
        </div>
      </div>
    </header>
  )
}

function HomePage({ products, catalogueStatus, catalogueError, onRetry, onAdd }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const featured = products.filter((product) => product.active).slice(0, 3)
  const submitSearch = (event) => {
    event.preventDefault()
    const query = search.trim()
    navigate(query ? `/shop?q=${encodeURIComponent(query)}` : '/shop')
  }
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> FRESH PRAWNS · HYDERABAD</div>
          <h1>Bring home<br /><em>a better catch.</em></h1>
          <p>Pick your prawns, choose cleaned or uncleaned, and find the right size for dinner.</p>
          <form className="hero-search" role="search" onSubmit={submitSearch}>
            <Search size={19} aria-hidden="true" />
            <label className="sr-only" htmlFor="home-product-search">Search prawns</label>
            <input id="home-product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search prawns or size" />
            <button type="submit" aria-label="Search catalogue"><ArrowRight size={19} /></button>
          </form>
          <div className="hero-cta">
            <Link to="/shop" className="button button-dark">Shop today's catch <ArrowRight size={17} /></Link>
            <span className="delivery-note"><MapPin size={16} /> Hyderabad delivery</span>
          </div>
          <nav className="hero-quick-cats" aria-label="Shop by prawn size">
            <span>Popular sizes</span>
            <Link to="/shop?size=Small">Small</Link>
            <Link to="/shop?size=Medium">Medium</Link>
            <Link to="/shop?size=Large">Large</Link>
          </nav>
        </div>
        <div className="hero-visual">
          <img src="https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=1100&q=85" alt="Fresh prawns ready to be prepared" />
          <div className="hero-image-label"><span className="fresh-seal"><Fish size={20} /></span><span><strong>Made your way</strong><small>Cleaned or uncleaned</small></span></div>
          <span className="hero-photo-tag">FROM OUR SHOP TO YOUR TABLE</span>
        </div>
      </section>

      <section className="trust-strip" aria-label="Our service highlights">
        <div><BadgeCheck /><span><b>One local shop</b><small>Personal service in Hyderabad</small></span></div>
        <div><Fish /><span><b>Prepared your way</b><small>Cleaned or uncleaned</small></span></div>
        <div><Truck /><span><b>Delivery choices</b><small>Shop rider or delivery partner</small></span></div>
      </section>

      <section className="section-block popular-section">
        <SectionHeading eyebrow="THE SHOP COUNTER" title="Today's catch" description="Browse available prawns, current prices and weights." action={<Link to="/shop" className="text-link">See the full shop <ArrowRight size={16} /></Link>} />
        {products.some((product) => product.sampleData) && <p className="catalogue-sample-note" role="note">Some product prices and stock are sample values.</p>}
        {catalogueStatus !== 'ready'
          ? <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />
          : featured.length
            ? <div className="product-grid">{featured.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>
            : <CatalogueFeedback status="empty" />}
      </section>

      <section id="our-promise" className="promise-section">
        <div className="promise-photo"><img src="https://images.unsplash.com/photo-1579684947550-22e945225d9a?auto=format&fit=crop&w=1000&q=85" alt="A freshly prepared seafood dish" /></div>
        <div className="promise-copy"><div className="eyebrow">ABOUT THE SHOP</div><h2>Your local prawn shop.</h2><p>Fresh Prawns Online is a single-owner shop serving Hyderabad. Choose your prawns and how you want them prepared; we’ll arrange delivery.</p></div>
      </section>
      <SupportSection />
    </main>
  )
}

function SectionHeading({ eyebrow, title, description, action }) {
  return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
}

function CatalogueFeedback({ status, error, onRetry }) {
  if (status === 'loading') {
    return <div className="empty-state" role="status"><Fish size={34} /><h2>Bringing in today's catch</h2><p>Loading the latest products, prices and availability…</p></div>
  }
  if (status === 'error') {
    return <div className="empty-state" role="alert"><Fish size={34} /><h2>We couldn’t load the catalogue</h2><p>{error || 'The product service is temporarily unavailable.'}</p><button className="button button-outline" type="button" onClick={onRetry}>Try again</button></div>
  }
  return <div className="empty-state"><Fish size={34} /><h2>No prawns available right now</h2><p>Please check back soon for the next fresh catch.</p></div>
}

function ProductCard({ product, onAdd }) {
  const quickPreparation = product.preparationOptions.find((option) => option.type === 'uncleaned' && option.enabled)
    || product.preparationOptions.find((option) => option.type === 'cleaned' && option.enabled)
  const canQuickAdd = product.availableGrams >= 500 && product.pricePerKg !== null && Boolean(quickPreparation)
  const preparationLabel = quickPreparation?.type === 'cleaned' ? 'cleaned' : 'uncleaned'
  return (
    <article className="product-card">
      <Link to={`/product/${product.id}`} className="product-photo" aria-label={`View ${product.name}`}>
        {product.image && <img src={product.image} alt={product.name} />}
        <span className="product-photo-badge"><Sparkles size={13} /> Shop pick</span>
      </Link>
      <div className="product-card-body">
        <div className="product-meta"><span>{product.size}</span><span className={`availability ${product.availableGrams < 500 ? 'unavailable' : ''}`}><i />{product.availableGrams >= 500 ? 'In stock' : 'Unavailable'}</span></div>
        <h3><Link to={`/product/${product.id}`}>{product.name}</Link></h3>
        <p>{product.description}</p>
        <div className="product-card-bottom">
          <div><strong>{product.pricePerKg === null ? 'Price updating' : money(product.pricePerKg)}</strong>{product.pricePerKg !== null && <small> / kg</small>}</div>
          <Link className="product-details-link" to={`/product/${product.id}`}>Details <ArrowRight size={15} /></Link>
        </div>
        <button className="product-quick-add" type="button" disabled={!canQuickAdd} onClick={() => onAdd(product, quickPreparation.type === 'cleaned', 500)}>
          <ShoppingBag size={16} /> {canQuickAdd ? `Quick add · 500 g ${preparationLabel}` : 'Currently unavailable'}
        </button>
      </div>
    </article>
  )
}

function ShopPage({ products, catalogueStatus, catalogueError, onRetry, onAdd }) {
  const [searchParams] = useSearchParams()
  const categories = ['All prawns', 'Small', 'Medium', 'Large']
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [filter, setFilter] = useState(() => {
    const size = searchParams.get('size')
    return categories.includes(size) ? size : 'All prawns'
  })
  const normalizedSearch = search.trim().toLowerCase()
  const visible = products.filter((product) => {
    const searchableText = `${product.name} ${product.size} ${product.description}`.toLowerCase()
    return product.active
      && searchableText.includes(normalizedSearch)
      && (filter === 'All prawns' || product.size.toLowerCase() === filter.toLowerCase())
  })
  return <main className="page-main"><div className="page-title-row"><div><div className="eyebrow">FROM OUR COUNTER TO YOUR KITCHEN</div><h1>Shop prawns</h1><p>Fresh picks for whatever you're cooking up.</p></div><span className="catalogue-count">{catalogueStatus === 'ready' ? `${products.filter((product) => product.active).length} fresh picks` : catalogueStatus === 'loading' ? 'Updating catalogue' : 'Catalogue unavailable'}</span></div>
    {products.some((product) => product.sampleData) && <p className="catalogue-sample-note" role="note">Some product prices and stock are sample values.</p>}
    <div className="catalogue-tools">
      <div className="filter-pills" role="group" aria-label="Filter by prawn size">{categories.map((category) => <button key={category} className={filter === category ? 'filter-pill active' : 'filter-pill'} aria-pressed={filter === category} onClick={() => setFilter(category)} type="button">{category}</button>)}</div>
      <div className="search-box"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="catalogue-search">Search prawns by name or size</label><input id="catalogue-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find prawns by name or size" />{search && <button className="search-clear" type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div>
    </div>
    <p className="catalogue-result-count" aria-live="polite">{catalogueStatus === 'ready' ? `${visible.length} ${visible.length === 1 ? 'product' : 'products'} found` : catalogueStatus === 'loading' ? 'Loading the current catalogue' : 'The catalogue is temporarily unavailable'}</p>
    {catalogueStatus !== 'ready'
      ? <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />
      : visible.length
        ? <div className="product-grid catalogue-grid">{visible.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>
        : products.length
          ? <div className="empty-state"><Fish size={34} /><h2>No prawns found</h2><p>Try another name or size filter.</p><button className="button button-outline" onClick={() => { setFilter('All prawns'); setSearch('') }}>Clear filters</button></div>
          : <CatalogueFeedback status="empty" />}
    <div className="catalogue-note"><Sparkles size={17} /> Prices and available weights are supplied by the shop and can change with today's catch.</div>
  </main>
}

function ProductPage({ products, catalogueStatus, catalogueError, onRetry, onAdd }) {
  const { id } = useParams()
  const product = products.find((item) => item.id === id && item.active)
  const [cleaned, setCleaned] = useState(true)
  const [weight, setWeight] = useState(500)
  const [quantity, setQuantity] = useState(1)
  if (catalogueStatus === 'loading' || catalogueStatus === 'error') {
    return <main className="page-main"><CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} /></main>
  }
  if (!product) return <NotFound />
  const cleanedOption = product.preparationOptions.find((option) => option.type === 'cleaned' && option.enabled)
  const uncleanedOption = product.preparationOptions.find((option) => option.type === 'uncleaned' && option.enabled)
  const prepFee = cleaned ? product.cleaningFee : 0
  const price = product.pricePerKg === null ? null : (product.pricePerKg * weight / 1000 + prepFee) * quantity
  const maxQuantity = Math.floor(product.availableGrams / weight)
  const handleAdd = () => onAdd(product, cleaned, weight, quantity)
  return <main className="page-main detail-page"><Link to="/shop" className="back-link"><ArrowLeft size={16} /> Back to all prawns</Link>{product.sampleData && <p className="catalogue-sample-note" role="note">Sample product. Price and stock may be illustrative.</p>}<div className="detail-layout"><div className="detail-image">{product.image && <img src={product.image} alt={product.name} />}</div><div className="detail-info"><div className="eyebrow">{product.size} · {product.origin}</div><h1>{product.name}</h1><p className="detail-description">{product.longDescription || product.description}</p><div className="detail-price">{product.pricePerKg === null ? 'Price updating' : <>{money(product.pricePerKg)} <small>/ kg</small></>}<span className="price-date"><Clock3 size={13} /> Price per kilogram</span></div>
      <div className="option-group"><div className="option-heading"><b>How would you like them?</b><span>Choose your prep</span></div><div className="prep-options"><button type="button" disabled={!uncleanedOption} onClick={() => setCleaned(false)} className={`prep-option ${!cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Uncleaned</b><small>As they come, fresh & whole</small></span><strong>Included</strong></button><button type="button" disabled={!cleanedOption} onClick={() => setCleaned(true)} className={`prep-option ${cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Cleaned</b><small>Deveined & ready to cook</small></span><strong>+{money(product.cleaningFee)}</strong></button></div></div>
      <div className="option-group"><div className="option-heading"><b>Pick your weight</b><span>{product.availableGrams ? `${formatWeight(product.availableGrams)} available` : 'Currently out of stock'}</span></div><div className="weight-options">{[250, 500, 1000].map((grams) => <button key={grams} type="button" disabled={grams > product.availableGrams} className={`weight-option ${weight === grams ? 'selected' : ''}`} onClick={() => { setWeight(grams); setQuantity(Math.min(quantity, Math.floor(product.availableGrams / grams))) }}>{grams >= 1000 ? '1 kg' : `${grams} g`}</button>)}</div></div>
      <div className="detail-buy-row"><div className="quantity-picker"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus size={15} /></button><span>{quantity}</span><button type="button" aria-label="Increase quantity" disabled={quantity >= maxQuantity} onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}><Plus size={15} /></button></div><button type="button" className="button button-dark add-to-cart" disabled={!maxQuantity || !price || (cleaned && !cleanedOption) || (!cleaned && !uncleanedOption)} onClick={handleAdd}><ShoppingBag size={17} /> {price === null ? 'Price unavailable' : !maxQuantity ? 'Out of stock' : <>Add to cart · {money(price)}</>}</button></div>
      <div className="detail-delivery-note"><Truck size={17} /><span><b>Delivery across Hyderabad</b><small>Choose a delivery option at checkout · from ₹{deliveryFee}</small></span></div>
    </div></div></main>
}

function getLinePrice(item, product) {
  return (product.pricePerKg * item.weight / 1000 + (item.cleaned ? product.cleaningFee : 0)) * item.quantity
}

function CartPage({ cart, products, onChange }) {
  const lines = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) })).filter((item) => item.product)
  const subtotal = lines.reduce((sum, item) => sum + getLinePrice(item, item.product), 0)
  return <main className="page-main"><h1 className="page-heading">Your cart</h1>{!lines.length ? <div className="empty-state cart-empty"><ShoppingBag size={36} /><h2>Your cart is empty</h2><p>Add prawns to start an order.</p><Link to="/shop" className="button button-dark">Browse prawns <ArrowRight size={16} /></Link></div> : <div className="cart-layout"><section className="cart-items"><div className="cart-column-heading"><span>ITEM</span><span>QUANTITY</span><span>SUBTOTAL</span></div>{lines.map((item) => <article className="cart-item" key={item.key}><Link to={`/product/${item.product.id}`} className="cart-item-image"><img src={item.product.image} alt="" /></Link><div className="cart-item-info"><Link to={`/product/${item.product.id}`}><b>{item.product.name}</b></Link><small>{item.cleaned ? 'Cleaned' : 'Uncleaned'} · {item.weight >= 1000 ? '1 kg' : `${item.weight} g`}</small><span>{money(item.product.pricePerKg)} / kg</span><button type="button" className="remove-link" onClick={() => onChange(item.key, -item.quantity)}>Remove</button></div><div className="quantity-picker cart-quantity"><button aria-label={`Decrease ${item.product.name} quantity`} onClick={() => onChange(item.key, -1)}><Minus size={14} /></button><span>{item.quantity}</span><button aria-label={`Increase ${item.product.name} quantity`} onClick={() => onChange(item.key, 1)}><Plus size={14} /></button></div><strong className="cart-line-price">{money(getLinePrice(item, item.product))}</strong></article>)}
      <Link className="continue-shopping" to="/shop"><ArrowLeft size={16} /> Keep browsing</Link></section><aside className="order-summary"><h2>Order summary</h2><div className="summary-row"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Delivery</span><span>Calculated at checkout</span></div><div className="summary-total"><span>Total</span><strong>{money(subtotal)}</strong></div><p className="summary-disclaimer">Delivery fee is shown before you place the order.</p><Link to="/checkout" className="button button-dark full-button">Continue to checkout <ArrowRight size={17} /></Link><div className="secure-note"><BadgeCheck size={15} /> Pay on delivery</div></aside></div>}</main>
}

function AccountPage({ currentUser, authStatus, onAuthenticated, onSignOut }) {
  const navigate = useNavigate()
  const location = useLocation()
  const googleButtonRef = useRef(null)
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const buttonContainer = googleButtonRef.current
    if (!googleClientId || !buttonContainer || currentUser || authStatus === 'loading') return undefined
    let active = true
    googleCredentialHandler = async (credential) => {
      setBusy(true)
      setError('')
      try {
        const { data } = await apiRequest('/api/v1/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential }),
        })
        onAuthenticated(data)
        const destination = location.state?.from
        navigate(typeof destination === 'string' && destination.startsWith('/') && !destination.startsWith('//') ? destination : '/', { replace: true })
      } catch (requestError) {
        setError(requestError.message || 'Google sign-in failed. Please try again.')
      } finally {
        setBusy(false)
      }
    }
    loadGoogleIdentityScript()
      .then((google) => {
        if (!active) return
        if (googleConfiguredClientId !== googleClientId) {
          google.accounts.id.initialize({
            client_id: googleClientId,
            callback: (response) => googleCredentialHandler?.(response.credential),
          })
          googleConfiguredClientId = googleClientId
        }
        buttonContainer.replaceChildren()
        google.accounts.id.renderButton(buttonContainer, {
          theme: 'outline',
          size: 'small',
          shape: 'rectangular',
          text: mode === 'register' ? 'signup_with' : 'signin_with',
          width: Math.min(220, buttonContainer.clientWidth || 220),
        })
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Google sign-in could not be loaded.') })
    return () => {
      active = false
      googleCredentialHandler = null
      buttonContainer.replaceChildren()
    }
  }, [authStatus, currentUser, location.state?.from, mode, navigate, onAuthenticated])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const { data } = await apiRequest(`/api/v1/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      })
      onAuthenticated(data)
      const destination = location.state?.from
      navigate(typeof destination === 'string' && destination.startsWith('/') && !destination.startsWith('//') ? destination : '/', { replace: true })
    } catch (requestError) {
      setError(requestError.message || 'Could not sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (authStatus === 'loading') {
    return <main className="page-main"><div className="empty-state" role="status"><h1>Checking your account…</h1></div></main>
  }

  if (currentUser) {
    return <main className="page-main account-page"><div className={`account-card ${currentUser.role === 'customer' ? 'account-dashboard' : ''}`}><div className="eyebrow">YOUR FRESH PRAWNS ACCOUNT</div><h1>Welcome back</h1><p>{currentUser.email}</p><p className="account-role">{currentUser.role === 'admin' ? 'Administrator account' : 'Customer account'}</p><div className="account-actions"><Link className="button button-dark" to={currentUser.role === 'admin' ? '/admin' : '/shop'}>{currentUser.role === 'admin' ? 'Open admin dashboard' : 'Continue shopping'} <ArrowRight size={16} /></Link>{currentUser.role === 'customer' && <Link className="button button-outline" to="/track"><PackageCheck size={16} /> Track orders</Link>}<button className="button button-outline" type="button" onClick={onSignOut}>Sign out</button></div></div></main>
  }

  return <main className="page-main account-page"><div className="account-card"><h1>{mode === 'register' ? 'Create your account' : 'Sign in'}</h1><p>{mode === 'register' ? 'Create an account to place and track orders.' : 'Sign in to place an order or track your orders.'}</p><div className="account-mode" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button></div>{googleClientId ? <><div className="google-signin" aria-label={mode === 'register' ? 'Sign up with Google' : 'Sign in with Google'}><div ref={googleButtonRef} /></div><div className="account-divider"><span>or</span></div></> : <p className="account-note">Use your email and password to continue.</p>}<form className="account-form" onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" maxLength="254" required /></label><label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength="12" maxLength="128" required /><small>At least 12 characters.</small></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-dark full-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button></form><p className="account-note">Admin accounts are created by the shop owner.</p></div></main>
}

function CustomerOrderHistory({ authToken }) {
  const [orders, setOrders] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!authToken) return undefined
    let active = true
    let inFlight = false
    const refreshOrders = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const { data, pagination } = await apiRequest('/api/v1/orders?limit=20', { token: authToken })
        if (!active) return
        setOrders((previous) => {
          const currentPageIds = new Set(data.map((order) => order.id))
          return [...data, ...previous.filter((order) => !currentPageIds.has(order.id))]
        })
        setNextCursor(pagination?.nextCursor || null)
        setStatus((previousStatus) => data.length || previousStatus === 'ready' ? 'ready' : 'empty')
        setError('')
      } catch (requestError) {
        if (!active) return
        setError(requestError.message || 'Could not load your orders.')
        setStatus('error')
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(refreshOrders, 5000)
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshOrders() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    refreshOrders()
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [authToken, retry])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    try {
      const { data, pagination } = await apiRequest(`/api/v1/orders?limit=20&cursor=${encodeURIComponent(nextCursor)}`, { token: authToken })
      setOrders((previous) => {
        const knownIds = new Set(previous.map((order) => order.id))
        return [...previous, ...data.filter((order) => !knownIds.has(order.id))]
      })
      setNextCursor(pagination?.nextCursor || null)
    } catch (requestError) {
      setError(requestError.message || 'Could not load older orders.')
    } finally {
      setLoadingMore(false)
    }
  }

  const labels = { pending: 'Pending', confirmed: 'Confirmed', preparing: 'Processing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }
  return <section className="customer-orders" aria-labelledby="customer-orders-heading">
    <div className="customer-orders-heading"><div><h2 id="customer-orders-heading">Your orders</h2><p>Orders placed with this account, updated from the shop.</p></div><button type="button" className="text-button" onClick={() => { setError(''); setStatus('loading'); setRetry((count) => count + 1) }} disabled={status === 'loading'}>Refresh</button></div>
    {status === 'loading' && <p role="status">Loading your orders…</p>}
    {status === 'error' && <div className="form-error" role="alert">{error}<button type="button" className="text-button" onClick={() => { setError(''); setStatus('loading'); setRetry((count) => count + 1) }}> Try again</button></div>}
    {status === 'empty' && <div className="customer-orders-empty"><PackageCheck size={22} /><p>Your orders will appear here after checkout.</p><Link to="/shop" className="text-link">Browse prawns <ArrowRight size={14} /></Link></div>}
    {orders.length > 0 && <div className="customer-order-list">{orders.map((order) => <article className="customer-order-card" key={order.id}>
      <div className="customer-order-top"><div><b>{`FP-${order.id.slice(-6).toUpperCase()}`}</b><small>{new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div><span className={`admin-status ${String(order.status).replaceAll('_', '-')}`}>{labels[order.status] || order.status}</span></div>
      <div className="customer-order-items">{order.items.map((item, index) => <span key={`${order.id}-${index}`}>{item.productName} · {formatWeight(item.weightGrams)} × {item.quantity} · {item.preparation}</span>)}</div>
      <div className="customer-order-bottom"><span>{toPaymentDisplay(order).paymentMethodLabel} · {toPaymentDisplay(order).paymentStatusLabel}</span><strong>{money(order.totalPaise / 100)}</strong></div>
      <Link to={`/track?order=${encodeURIComponent(order.id)}`} className="text-link">View order updates <ArrowRight size={14} /></Link>
    </article>)}</div>}
    {error && status !== 'error' && <p className="form-error" role="alert">{error}</p>}
    {nextCursor && <button className="button button-outline full-button" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older orders'}</button>}
  </section>
}

function CheckoutPage({ cart, products, currentUser, authToken, onPlaceOrder }) {
  const navigate = useNavigate()
  const idempotencyKeyRef = useRef(null)
  const [deliveryMethod, setDeliveryMethod] = useState('shop')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const lines = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) })).filter((item) => item.product)
  const subtotal = lines.reduce((sum, item) => sum + getLinePrice(item, item.product), 0)
  const delivery = deliveryMethod === 'shop' ? deliveryFee : 60
  const total = subtotal + (lines.length ? delivery : 0)
  const submit = async (event) => {
    event.preventDefault()
    if (!lines.length || !currentUser || !authToken) return
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setSubmitError('')
    idempotencyKeyRef.current ||= crypto.randomUUID()
    try {
      const { data } = await apiRequest('/api/v1/orders', {
        method: 'POST',
        token: authToken,
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          customer: { name: form.get('name'), phone: form.get('phone') },
          address: {
            line: form.get('address'),
            locality: form.get('locality'),
            postalCode: form.get('postalCode'),
          },
          deliveryMethod,
          items: lines.map((item) => ({
            productSlug: item.product.slug,
            preparation: item.cleaned ? 'cleaned' : 'uncleaned',
            weightGrams: item.weight,
            quantity: item.quantity,
          })),
        }),
      })
      onPlaceOrder(toCustomerOrder(data))
      idempotencyKeyRef.current = null
      navigate(`/track?order=${data.id}`)
    } catch (error) {
      setSubmitError(error.message || 'We could not place the order. Please review your cart and try again.')
    } finally {
      setSubmitting(false)
    }
  }
  if (!lines.length) return <main className="page-main empty-checkout"><div className="empty-state"><ShoppingBag size={35} /><h2>Your cart is waiting for prawns</h2><p>Add something fresh before heading to checkout.</p><Link to="/shop" className="button button-dark">Shop prawns <ArrowRight size={16} /></Link></div></main>
  if (!currentUser || currentUser.role !== 'customer') return <main className="page-main empty-checkout"><div className="empty-state"><ShoppingBag size={35} /><h2>{currentUser ? 'Customer checkout required' : 'Sign in before checkout'}</h2><p>Your cart will be here when you return. Orders require a customer account.</p><Link to="/account" state={{ from: '/checkout' }} className="button button-dark">{currentUser ? 'Switch account' : 'Sign in or create account'} <ArrowRight size={16} /></Link></div></main>
  return <main className="page-main"><Link to="/cart" className="back-link"><ArrowLeft size={16} /> Back to cart</Link><h1 className="page-heading">Checkout</h1><div className="checkout-layout"><form className="checkout-form" onSubmit={submit} onChange={() => { idempotencyKeyRef.current = null }}><section className="checkout-panel"><div className="form-section-title"><div><h2>Your details</h2><p>Delivery contact information.</p></div></div><div className="form-grid"><label>Full name<input name="name" autoComplete="name" placeholder="e.g. Ananya Rao" required /></label><label>Mobile number<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" required /></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><div><h2>Delivery address</h2><p>Delivery is currently available in Hyderabad.</p></div></div><label className="full-label">Address<textarea name="address" autoComplete="street-address" rows="3" placeholder="House / flat, street, Hyderabad" required /></label><div className="form-grid"><label>Area / locality<input name="locality" autoComplete="address-level2" placeholder="e.g. Banjara Hills" required /></label><label>PIN code<input name="postalCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="500034" required /></label></div></section>
      <div className="location-placeholder"><div className="location-pin"><MapPin size={19} /></div><div><b>Choose a delivery location</b><small>Map and live location will be available in a future phase.</small></div><button type="button" className="location-disabled" disabled>Map coming soon</button></div>
      <section className="checkout-panel"><div className="form-section-title"><div><h2>Delivery method</h2><p>Select who will deliver your order.</p></div></div><div className="delivery-options"><label className={`delivery-choice ${deliveryMethod === 'shop' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'shop'} onChange={() => setDeliveryMethod('shop')} /><span className="delivery-icon"><Truck size={20} /></span><span><b>Our delivery person</b><small>Shop-arranged delivery</small></span><strong>₹40 est.</strong></label><label className={`delivery-choice ${deliveryMethod === 'third_party' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'third_party'} onChange={() => setDeliveryMethod('third_party')} /><span className="delivery-icon"><PackageCheck size={20} /></span><span><b>Delivery partner</b><small>Arranged by the shop</small></span><strong>₹60 est.</strong></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><div><h2>Payment</h2></div></div><div className="payment-placeholder"><Banknote size={19} /><span><b>Pay on delivery</b><small>Payment is collected when your order arrives.</small></span></div></section>
      {submitError && <p className="form-error" role="alert">{submitError}</p>}<button type="submit" disabled={submitting} className="button button-dark full-button place-order">{submitting ? 'Placing order…' : `Place order · ${money(total)} est.`} <ArrowRight size={17} /></button></form>
    <aside className="order-summary checkout-summary"><h2>Your order</h2>{lines.map((item) => <div className="summary-product" key={item.key}><img src={item.product.image} alt="" /><span><b>{item.product.name}</b><small>{item.cleaned ? 'Cleaned' : 'Uncleaned'} · {item.weight >= 1000 ? '1 kg' : `${item.weight} g`} × {item.quantity}</small></span><strong>{money(getLinePrice(item, item.product))}</strong></div>)}<div className="summary-row"><span>Subtotal estimate</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Delivery estimate</span><b>{money(delivery)}</b></div><div className="summary-total"><span>Total estimate</span><strong>{money(total)}</strong></div><div className="checkout-summary-note"><BadgeCheck size={15} /> Pay on delivery</div></aside></div></main>
}

function TrackPage({ order, authToken, currentUser }) {
  const [searchParams] = useSearchParams()
  const [lookup, setLookup] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [foundOrder, setFoundOrder] = useState(null)
  const [lookupError, setLookupError] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const orderId = searchParams.get('order')
  const [loadedOrder, setLoadedOrder] = useState(null)
  const [eventsState, setEventsState] = useState({ orderId: '', events: [], error: '' })
  const trackedOrderId = hasSearched ? foundOrder?.orderId : (orderId || order?.orderId)
  useEffect(() => {
    if (!trackedOrderId || !authToken) return undefined
    let active = true
    let inFlight = false
    const refreshOrder = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const encodedId = encodeURIComponent(trackedOrderId)
        const [{ data: orderData }, { data: events }] = await Promise.all([
          apiRequest(`/api/v1/orders/${encodedId}`, { token: authToken }),
          apiRequest(`/api/v1/orders/${encodedId}/events`, { token: authToken }),
        ])
        if (!active) return
        setLoadedOrder(toCustomerOrder(orderData))
        setEventsState({ orderId: trackedOrderId, events, error: '' })
      } catch (error) {
        if (!active) return
        setEventsState((previous) => ({
          orderId: trackedOrderId,
          events: previous.orderId === trackedOrderId ? previous.events : [],
          error: error.message || 'Could not refresh order updates.',
        }))
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(refreshOrder, 5000)
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshOrder() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    refreshOrder()
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [trackedOrderId, authToken])
  const shownOrder = hasSearched
    ? (loadedOrder?.orderId === trackedOrderId ? loadedOrder : foundOrder)
    : (loadedOrder?.orderId === trackedOrderId ? loadedOrder : order?.orderId === trackedOrderId ? order : null)
  const orderEvents = eventsState.orderId === shownOrder?.orderId ? eventsState.events : []
  const eventsError = eventsState.orderId === shownOrder?.orderId ? eventsState.error : ''
  const searchOrders = async (event) => {
    event.preventDefault()
    setHasSearched(true)
    setFoundOrder(null)
    setLookupError('')
    if (!authToken) {
      setLookupError('Sign in to find your orders.')
      return
    }
    setLookupBusy(true)
    try {
      const { data } = await apiRequest('/api/v1/orders', { token: authToken })
      const query = lookup.trim().toLowerCase()
      const match = data.find((item) => item.id.toLowerCase() === query
        || `fp-${item.id.slice(-6)}`.toLowerCase() === query)
      if (!match) {
        setLookupError('No matching order was found in your account.')
        return
      }
      setFoundOrder(toCustomerOrder(match))
    } catch (error) {
      setLookupError(error.message || 'Could not search your orders.')
    } finally {
      setLookupBusy(false)
    }
  }
  const steps = ['Confirmed', 'Processing', 'Out for delivery', 'Delivered']
  const statusSteps = { pending: 0, confirmed: 0, preparing: 1, out_for_delivery: 2, delivered: 3 }
  const stage = statusSteps[shownOrder?.status] ?? statusSteps[String(shownOrder?.status || '').toLowerCase()] ?? -1
  return <main className="page-main tracking-page"><h1 className="page-heading">{currentUser?.role === 'customer' ? 'Track your orders' : 'Track your order'}</h1><p className="tracking-intro">View order status, delivery details and updates.</p>
    {currentUser?.role === 'customer' && <CustomerOrderHistory key={currentUser.id || currentUser.email} authToken={authToken} />}
    {currentUser?.role !== 'customer' && <><form className="tracking-search" onSubmit={searchOrders}><label htmlFor="order-lookup">Order number</label><div><input id="order-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="e.g. FP-123456" required /><button className="button button-dark" type="submit" disabled={lookupBusy}>{lookupBusy ? 'Searching…' : 'Find order'} <ArrowRight size={16} /></button></div><small>Sign in with the customer account that placed the order.</small></form>{lookupError && <p className="form-error" role="alert">{lookupError}</p>}</>}
    {!currentUser?.role && !shownOrder && <div className="tracking-empty"><div className="tracking-empty-icon"><PackageCheck size={29} /></div><h2>Sign in to track your orders</h2><p>Your order list is linked securely to your customer account.</p><Link to="/account" className="button button-dark">Sign in or create an account <ArrowRight size={16} /></Link></div>}
    {currentUser?.role === 'admin' && <div className="tracking-empty"><h2>Orders are managed in the admin dashboard.</h2><Link to="/admin" className="button button-outline">Open admin dashboard <ArrowRight size={16} /></Link></div>}
    {shownOrder && <section className="tracking-card"><div className="tracking-card-head"><div><span className="status-pill"><i /> {shownOrder.status === 'pending' ? 'Pending' : shownOrder.status === 'preparing' ? 'Processing' : shownOrder.status}</span><h2>Order {shownOrder.id}</h2><p>Placed {shownOrder.createdAt}</p></div><strong>{money(shownOrder.total)}</strong></div><div className="tracking-steps">{steps.map((step, index) => <div className={`tracking-step ${index <= stage ? 'completed' : ''}`} key={step}><span className="tracking-step-icon">{index <= stage ? <Check size={15} /> : index === 1 ? <Fish size={15} /> : index === 2 ? <Truck size={15} /> : <PackageCheck size={15} />}</span><b>{step}</b>{index < steps.length - 1 && <span className="tracking-step-line" />}</div>)}</div><div className="tracking-order-meta"><div><MapPin size={16} /><span><b>Delivering to</b><small>{shownOrder.address || 'Hyderabad'}</small></span></div><div><Truck size={16} /><span><b>Delivery method</b><small>{shownOrder.deliveryMethod === 'partner' ? 'Third-party service' : 'Our delivery person'}</small></span></div><div><PackageCheck size={16} /><span><b>Delivery status</b><small>{deliveryStatusLabel(shownOrder.delivery?.status)}</small></span></div><div><Banknote size={16} /><span><b>Payment</b><small>{shownOrder.paymentMethodLabel} · {shownOrder.paymentStatusLabel}</small></span></div>{shownOrder.delivery?.method === 'shop' && shownOrder.delivery.personName && <div><Headset size={16} /><span><b>Delivery contact</b><small>{shownOrder.delivery.personName}{shownOrder.delivery.personPhone ? ` · ${shownOrder.delivery.personPhone}` : ''}</small></span></div>}{shownOrder.delivery?.method === 'third_party' && (shownOrder.delivery.serviceName || shownOrder.delivery.reference) && <div><PackageCheck size={16} /><span><b>Delivery reference</b><small>{[shownOrder.delivery.serviceName, shownOrder.delivery.reference].filter(Boolean).join(' · ')}</small></span></div>}</div><section className="order-event-history" aria-labelledby="customer-order-events"><h3 id="customer-order-events">Order updates</h3>{eventsError && <p className="form-error" role="alert">{eventsError}</p>}{orderEvents.length ? <ol>{orderEvents.map((item) => <li key={item.id}><b>{item.type.replaceAll('_', ' ')}</b><small>{item.from && item.to ? `${item.from.replaceAll('_', ' ')} → ${item.to.replaceAll('_', ' ')}` : item.to?.replaceAll('_', ' ')}</small><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></li>)}</ol> : !eventsError && <p>No updates recorded yet.</p>}</section></section>}
    <div className="tracking-support"><Headset size={18} /><span>Need a hand? <a href="tel:+919346338357">Call our shop at +91 93463 38357</a></span></div>
  </main>
}

function SupportSection() {
  return <section id="contact" className="support-section"><div className="support-icon"><Headset size={24} /></div><div><h2>Need help?</h2><p>Call the shop about your order.</p></div><div className="support-actions"><a className="button button-dark" href="tel:+919346338357">Call +91 93463 38357 <ArrowRight size={16} /></a></div></section>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><Link to="/" className="brand footer-brand"><span className="brand-mark"><Fish size={21} /></span><span className="brand-name">fresh<span>prawns</span><small>ONLINE · HYDERABAD</small></span></Link><div className="footer-links"><Link to="/shop">Shop</Link><Link to="/track">Track orders</Link><Link to="/account">My account</Link></div></div><div className="footer-bottom"><span>© 2026 Fresh Prawns Online · Hyderabad</span></div></footer>
}

function AdminPage({ products, catalogueStatus, catalogueError, onRetry, currentUser, authToken, authStatus, onSignOut }) {
  const [tab, setTab] = useState('overview')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [orders, setOrders] = useState([])
  const [ordersStatus, setOrdersStatus] = useState('loading')
  const [ordersError, setOrdersError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [ordersRetry, setOrdersRetry] = useState(0)
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'products', label: 'Products' }, { id: 'orders', label: 'Orders' }]
  useEffect(() => {
    if (currentUser?.role !== 'admin' || !authToken) return undefined
    let active = true
    let inFlight = false
    const refreshOrders = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const { data } = await apiRequest('/api/v1/orders', { token: authToken })
        if (!active) return
        const mapped = data.map(toAdminOrder)
        setOrders(mapped)
        setSelectedOrder((previous) => mapped.find((item) => item.rawId === previous?.rawId) || mapped[0] || null)
        setOrdersStatus(mapped.length ? 'ready' : 'empty')
        setOrdersError('')
      } catch (error) {
        if (!active) return
        setOrdersError(error.message || 'Could not load orders.')
        setOrdersStatus('error')
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(refreshOrders, 5000)
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshOrders() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    refreshOrders()
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [currentUser, authToken, ordersRetry])

  const updateOrder = async (displayId, patch) => {
    const order = orders.find((item) => item.id === displayId)
    if (!order) return false
    let path
    let body
    if (patch.status) {
      const statusValues = {
        Pending: 'pending',
        Confirmed: 'confirmed',
        Processing: 'preparing',
        'Out for delivery': 'out_for_delivery',
        Delivered: 'delivered',
        Cancelled: 'cancelled',
      }
      path = `/api/v1/orders/${order.rawId}/status`
      body = { status: statusValues[patch.status] }
    } else if (patch.deliveryAssignment) {
      path = `/api/v1/orders/${order.rawId}/delivery`
      body = patch.deliveryAssignment
    } else if (patch.deliveryStatus) {
      path = `/api/v1/orders/${order.rawId}/delivery/status`
      body = { status: patch.deliveryStatus }
    } else if (patch.paymentCollection) {
      path = `/api/v1/orders/${order.rawId}/payment/collection`
      body = {}
    } else {
      setOrders((items) => items.map((item) => item.id === displayId ? { ...item, ...patch } : item))
      return true
    }
    setStatusError('')
    try {
      await apiRequest(path, {
        method: 'PATCH',
        token: authToken,
        body: JSON.stringify(body),
      })
      const { data } = await apiRequest('/api/v1/orders', { token: authToken })
      const mapped = data.map(toAdminOrder)
      setOrders(mapped)
      setSelectedOrder(mapped.find((item) => item.rawId === order.rawId) || null)
      setOrdersStatus(mapped.length ? 'ready' : 'empty')
      return true
    } catch (error) {
      setStatusError(error.message || 'Could not update order status.')
      return false
    }
  }

  if (authStatus === 'loading') return <main className="page-main"><div className="empty-state" role="status"><h1>Checking administrator access…</h1></div></main>
  if (!currentUser) return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">SHOP ADMIN</div><h1>Administrator sign-in required</h1><p>Sign in with your provisioned administrator account to open the shop dashboard.</p><Link className="button button-dark" to="/account" state={{ from: '/admin' }}>Sign in <ArrowRight size={16} /></Link></div></main>
  if (currentUser.role !== 'admin') return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">SHOP ADMIN</div><h1>Administrator access only</h1><p>This customer account cannot open the shop dashboard.</p><Link className="button button-outline" to="/">Back to storefront</Link></div></main>

  return <main className="admin-page"><aside className="admin-sidebar"><Link to="/" className="admin-brand"><span className="brand-mark"><Fish size={21} /></span><span>Fresh Prawns<small>SHOP ADMIN</small></span></Link><div className="admin-side-label">WORKSPACE</div><nav aria-label="Admin navigation">{tabs.map((item) => <button className={tab === item.id ? 'admin-nav-item active' : 'admin-nav-item'} key={item.id} onClick={() => setTab(item.id)} type="button">{item.id === 'overview' ? <SlidersHorizontal size={17} /> : item.id === 'products' ? <Fish size={17} /> : <PackageCheck size={17} />}{item.label}{item.id === 'orders' && <span className="nav-count">{orders.length}</span>}</button>)}</nav><div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><span className="admin-sidebar-identity"><b>{currentUser.email}</b><small>Shop administrator</small></span><button className="admin-signout" onClick={onSignOut} type="button">Sign out</button></div></aside><div className="admin-content"><div className="admin-topbar"><div className="admin-breadcrumb">Workspace <span>/</span> <b>{tabs.find((item) => item.id === tab)?.label}</b></div><button className="admin-top-signout" onClick={onSignOut} type="button">Sign out</button><Link to="/" className="view-store-link"><ArrowLeft size={14} /> View storefront</Link></div><div className="admin-main-content">{tab === 'overview' && <AdminOverview products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={onRetry} orders={orders} setTab={setTab} />}{tab === 'products' && <AdminProducts products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={onRetry} authToken={authToken} />}{tab === 'orders' && <><AdminOrders orders={orders} selectedOrder={selectedOrder} setSelectedOrder={setSelectedOrder} onUpdateOrder={updateOrder} statusError={statusError} authToken={authToken} />{ordersStatus === 'loading' && <div role="status">Loading orders…</div>}{ordersStatus === 'error' && <div role="alert" className="form-error">{ordersError}<button type="button" onClick={() => { setOrdersStatus('loading'); setOrdersRetry((count) => count + 1) }}> Try again</button></div>}</>}</div></div></main>
}

function AdminOverview({ products, catalogueStatus, catalogueError, onRetry, orders, setTab }) {
  const revenue = orders.reduce((sum, order) => sum + order.total, 0)
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <h1>Overview</h1>
          <p>Recent orders, products and stock.</p>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="Listed order value" value={money(revenue)} icon={<Banknote />} />
        <Metric label="Recent orders" value={orders.length} icon={<PackageCheck />} />
        <Metric label="Active products" value={products.filter((product) => product.active).length} icon={<Fish />} />
      </div>
      <div className="admin-overview-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <h2>Recent orders</h2>
            <button className="admin-text-button" onClick={() => setTab('orders')}>View orders <ArrowRight size={14} /></button>
          </div>
          {orders.length ? <div className="recent-orders">{orders.slice(0, 4).map((order) => <button className="recent-order" key={order.id} onClick={() => setTab('orders')}><span><b>{order.id}</b><small>{order.customer} · {order.time}</small></span><span className={`admin-status ${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span></button>)}</div> : <p className="admin-demo-hint">No orders yet.</p>}
        </section>
        <section className="admin-card stock-glance">
          <div className="admin-card-heading">
            <h2>Available stock</h2>
            <button className="admin-text-button" onClick={() => setTab('products')}>Manage stock <ArrowRight size={14} /></button>
          </div>
          {catalogueStatus !== 'ready' && <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />}
          {catalogueStatus === 'ready' && (products.length ? <StockGlance products={products} /> : <CatalogueFeedback status="empty" />)}
        </section>
      </div>
    </>
  )
}

function StockGlance({ products }) {
  return <div className="stock-glance-grid">{products.slice(0, 3).map((product) => {
    const meterWidth = `${Math.min(product.stockKg / 20 * 100, 100)}%`
    return <div className="stock-glance-item" key={product.id}><span>{product.name}</span><b>{formatWeight(product.availableGrams)}</b><div className="stock-meter"><i style={{ width: meterWidth }} /></div></div>
  })}</div>
}

function Metric({ label, value, icon }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong></div>
}

function AdminProducts({ products, catalogueStatus, catalogueError, onRetry, authToken }) {
  const [adminProducts, setAdminProducts] = useState([])
  const [stockRows, setStockRows] = useState([])
  const [priceHistory, setPriceHistory] = useState([])
  const [movementHistory, setMovementHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [dataStatus, setDataStatus] = useState('loading')
  const [dataError, setDataError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/v1/admin/products?limit=100', { token: authToken }),
      apiRequest('/api/v1/admin/stock?limit=100', { token: authToken }),
    ]).then(([productResponse, stockResponse]) => {
      if (!active) return
      const nextProducts = productResponse.data.items
      setAdminProducts(nextProducts)
      setStockRows(stockResponse.data.items)
      setSelectedProductId((selected) => nextProducts.some((product) => product._id === selected)
        ? selected
        : nextProducts[0]?._id || '')
      setDataStatus('ready')
      setDataError('')
    }).catch((error) => {
      if (!active) return
      setDataError(error.message || 'Could not load product and stock management data.')
      setDataStatus('error')
    })
    return () => { active = false }
  }, [authToken, reload])

  const selectedProduct = adminProducts.find((product) => product._id === selectedProductId)
  useEffect(() => {
    if (!selectedProductId || !authToken) return undefined
    let active = true
    Promise.all([
      apiRequest(`/api/v1/admin/products/${selectedProductId}/prices?limit=20`, { token: authToken }),
      apiRequest(`/api/v1/admin/stock/${selectedProductId}/movements?limit=20`, { token: authToken }),
    ]).then(([prices, movements]) => {
      if (!active) return
      setPriceHistory(prices.data.items)
      setMovementHistory(movements.data.items)
      setHistoryError('')
    }).catch((error) => {
      if (active) setHistoryError(error.message || 'Could not load price and stock history.')
    })
    return () => { active = false }
  }, [selectedProductId, authToken, reload])
  const submitAction = async (event, action) => {
    event.preventDefault()
    const formElement = event.currentTarget
    setSaving(true)
    setActionError('')
    setActionSuccess('')
    try {
      await action(new FormData(formElement))
      setActionSuccess('Saved successfully.')
      setReload((count) => count + 1)
      onRetry()
      formElement.reset()
    } catch (error) {
      setActionError(error.message || 'Could not save this change.')
    } finally {
      setSaving(false)
    }
  }
  const activeOptions = (form) => {
    const options = []
    if (form.get('cleanedEnabled') === 'on') {
      options.push({ type: 'cleaned', enabled: true, feePaise: form.get('cleaningFee') ? rupeesToPaise(form.get('cleaningFee'), { allowZero: true }) : 0 })
    }
    if (form.get('uncleanedEnabled') === 'on') options.push({ type: 'uncleaned', enabled: true, feePaise: 0 })
    if (!options.length) throw new Error('Enable at least one preparation option.')
    return options
  }
  const productPayload = (form) => ({
    slug: String(form.get('slug')).trim(),
    name: String(form.get('name')).trim(),
    description: String(form.get('description')).trim(),
    longDescription: String(form.get('longDescription')).trim(),
    size: form.get('size'),
    origin: String(form.get('origin')).trim(),
    badge: String(form.get('badge')).trim(),
    imageUrl: String(form.get('imageUrl')).trim() || null,
    active: form.get('active') === 'on',
    preparationOptions: activeOptions(form),
  })
  const createProduct = async (form) => {
    await apiRequest('/api/v1/admin/products', {
      method: 'POST',
      token: authToken,
      body: JSON.stringify(productPayload(form)),
    })
  }
  const updateProduct = async (event) => {
    event.preventDefault()
    if (!selectedProduct) return
    setSaving(true)
    setActionError('')
    setActionSuccess('')
    try {
      const form = new FormData(event.currentTarget)
      const patch = productPayload(form)
      delete patch.slug
      await apiRequest(`/api/v1/admin/products/${selectedProduct._id}`, {
        method: 'PATCH',
        token: authToken,
        body: JSON.stringify(patch),
      })
      setActionSuccess('Product updated.')
      setReload((count) => count + 1)
      onRetry()
    } catch (error) {
      setActionError(error.message || 'Could not update this product.')
    } finally {
      setSaving(false)
    }
  }
  const addPrice = async (form) => {
    if (!selectedProduct) throw new Error('Choose a product first.')
    await apiRequest(`/api/v1/admin/products/${selectedProduct._id}/prices`, {
      method: 'POST',
      token: authToken,
      body: JSON.stringify({
        effectiveDate: form.get('effectiveDate'),
        pricePerKgPaise: rupeesToPaise(form.get('pricePerKg')),
      }),
    })
  }
  const adjustStock = async (form) => {
    const productId = form.get('stockProductId')
    await apiRequest(`/api/v1/admin/stock/${productId}/adjustments`, {
      method: 'POST',
      token: authToken,
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        deltaGrams: parseStockDelta(form.get('deltaGrams')),
        reason: form.get('reason'),
        reference: String(form.get('reference')).trim() || undefined,
      }),
    })
  }
  const stockByProduct = new Map(stockRows.map((row) => [row.product._id, row]))
  const priceBySlug = new Map(products.map((product) => [product.slug, product]))
  return <>
    <div className="admin-page-heading">
      <div><h1>Products and pricing</h1><p>Manage products, daily prices and stock.</p></div>
    </div>
    {dataStatus === 'loading' && <p role="status">Loading management data…</p>}
    {dataStatus === 'error' && <p className="form-error" role="alert">{dataError}<button type="button" onClick={() => setReload((count) => count + 1)}> Try again</button></p>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {actionSuccess && <p className="form-success" role="status">{actionSuccess}</p>}
    <div className="admin-phase6-grid">
      <section className="admin-card admin-phase6-card">
        <div className="admin-card-heading"><div><h2>Add product</h2><p>New products start active with no price or stock.</p></div></div>
        <form className="admin-phase6-form" onSubmit={(event) => submitAction(event, createProduct)}>
          <label>Product name<input name="name" required minLength="2" maxLength="120" /></label>
          <label>URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength="120" /></label>
          <label>Size<select name="size"><option>Small</option><option>Medium</option><option>Large</option></select></label>
          <label>Origin<input name="origin" maxLength="120" defaultValue="Coastal catch" /></label>
          <label>Short description<textarea name="description" rows="2" maxLength="2000" /></label>
          <label>Full description<textarea name="longDescription" rows="3" maxLength="4000" /></label>
          <label>Image HTTPS URL<input name="imageUrl" type="url" pattern="https://.*" /></label>
          <label>Badge<input name="badge" maxLength="40" /></label>
          <label className="admin-check"><input name="cleanedEnabled" type="checkbox" defaultChecked /> Cleaned option</label>
          <label>Cleaning fee (₹)<input name="cleaningFee" type="number" min="0" max="1000" step="0.01" defaultValue="0" /></label>
          <label className="admin-check"><input name="uncleanedEnabled" type="checkbox" defaultChecked /> Uncleaned option</label>
          <button type="submit" className="button button-dark" disabled={saving || dataStatus !== 'ready'}>{saving ? 'Saving…' : 'Create product'}</button>
        </form>
      </section>
      <section className="admin-card admin-phase6-card">
        <div className="admin-card-heading"><div><h2>Update product</h2><p>Deactivate to hide a product without deleting order history.</p></div></div>
        <label className="admin-phase6-select">Product<select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}><option value="">Choose product</option>{adminProducts.map((product) => <option key={product._id} value={product._id}>{product.name}{product.active ? '' : ' (inactive)'}</option>)}</select></label>
        {selectedProduct && <form className="admin-phase6-form" key={selectedProduct._id} onSubmit={updateProduct}>
          <label>Name<input name="name" required minLength="2" maxLength="120" defaultValue={selectedProduct.name} /></label>
          <label>Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength="120" defaultValue={selectedProduct.slug} /></label>
          <label>Size<select name="size" defaultValue={selectedProduct.size}><option>Small</option><option>Medium</option><option>Large</option></select></label>
          <label>Origin<input name="origin" maxLength="120" defaultValue={selectedProduct.origin} /></label>
          <label>Description<textarea name="description" rows="2" maxLength="2000" defaultValue={selectedProduct.description} /></label>
          <label>Full description<textarea name="longDescription" rows="3" maxLength="4000" defaultValue={selectedProduct.longDescription} /></label>
          <label>Image HTTPS URL<input name="imageUrl" type="url" pattern="https://.*" defaultValue={selectedProduct.imageUrl || ''} /></label>
          <label>Badge<input name="badge" maxLength="40" defaultValue={selectedProduct.badge} /></label>
          <label className="admin-check"><input name="cleanedEnabled" type="checkbox" defaultChecked={selectedProduct.preparationOptions.some((option) => option.type === 'cleaned' && option.enabled)} /> Cleaned option</label>
          <label>Cleaning fee (₹)<input name="cleaningFee" type="number" min="0" max="1000" step="0.01" defaultValue={(selectedProduct.preparationOptions.find((option) => option.type === 'cleaned')?.feePaise || 0) / 100} /></label>
          <label className="admin-check"><input name="uncleanedEnabled" type="checkbox" defaultChecked={selectedProduct.preparationOptions.some((option) => option.type === 'uncleaned' && option.enabled)} /> Uncleaned option</label>
          <label className="admin-check"><input name="active" type="checkbox" defaultChecked={selectedProduct.active} /> Product is active</label>
          <button type="submit" className="button button-outline" disabled={saving}>{saving ? 'Saving…' : 'Save product changes'}</button>
        </form>}
      </section>
      <section className="admin-card admin-phase6-card">
        <div className="admin-card-heading"><div><h2>Set daily price</h2><p>Effective at midnight Hyderabad time; future dates can be scheduled.</p></div></div>
        <form className="admin-phase6-form" onSubmit={(event) => submitAction(event, addPrice)}>
          <label>Product<select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} required>{adminProducts.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}</select></label>
          <label>Effective date<input name="effectiveDate" type="date" required defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} /></label>
          <label>Price per kg (₹)<input name="pricePerKg" type="number" min="0.01" max="10000000" step="0.01" required /></label>
          <button type="submit" className="button button-dark" disabled={saving || !adminProducts.length}>{saving ? 'Saving…' : 'Add price'}</button>
        </form>
      </section>
      <section className="admin-card admin-phase6-card">
        <div className="admin-card-heading"><div><h2>Adjust stock</h2><p>Use a positive quantity for stock received, negative for reductions.</p></div></div>
        <form className="admin-phase6-form" onSubmit={(event) => submitAction(event, adjustStock)}>
          <label>Product<select name="stockProductId" required>{adminProducts.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}</select></label>
          <label>Change (grams)<input name="deltaGrams" type="number" min="-1000000" max="1000000" step="1" required /></label>
          <label>Reason<select name="reason"><option value="received">Received</option><option value="spoilage">Spoilage</option><option value="correction">Correction</option><option value="other">Other</option></select></label>
          <label>Reference / note<input name="reference" maxLength="160" /></label>
          <button type="submit" className="button button-dark" disabled={saving || !adminProducts.length}>{saving ? 'Saving…' : 'Record stock adjustment'}</button>
        </form>
      </section>
    </div>
    {dataStatus === 'ready' && <section className="admin-card products-table-card">
      <div className="admin-table-top"><div><h2>Stock and catalogue</h2><p>Reserved quantities are controlled by orders and cannot be changed here.</p></div><span className="catalogue-count">{adminProducts.length} products</span></div>
      <div className="table-scroll"><table className="admin-table"><thead><tr><th>PRODUCT</th><th>PRICE / KG</th><th>ON HAND</th><th>RESERVED</th><th>AVAILABLE</th><th>LIVE</th></tr></thead><tbody>{adminProducts.map((product) => {
        const stock = stockByProduct.get(product._id)
        const price = priceBySlug.get(product.slug)
        return <tr key={product._id}><td><div className="table-product"><span><b>{product.name}</b><small>{product.size} · {product.origin}</small></span></div></td><td>{price?.pricePerKg === null || !price ? 'Not set' : money(price.pricePerKg)}</td><td>{formatWeight(stock?.onHandGrams || 0)}</td><td>{formatWeight(stock?.reservedGrams || 0)}</td><td>{formatWeight(stock?.availableGrams || 0)}</td><td>{product.active ? 'Active' : 'Inactive'}</td></tr>
      })}</tbody></table></div>
      <div className="admin-table-footer">Stock changes are recorded in the movement history.</div>
    </section>}
    {selectedProduct && <div className="admin-phase6-grid">
      <section className="admin-card products-table-card">
        <div className="admin-table-top"><div><h2>Price history · {selectedProduct.name}</h2><p>Effective dates use the Asia/Kolkata calendar.</p></div></div>
        {historyError && <p className="form-error" role="alert">{historyError}</p>}
        {priceHistory.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>EFFECTIVE FROM</th><th>PRICE / KG</th><th>SET BY</th></tr></thead><tbody>{priceHistory.map((price) => <tr key={price._id}><td>{new Date(price.effectiveFrom).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</td><td>{money(price.pricePerKgPaise / 100)}</td><td>{price.changedById ? 'Admin' : 'System'}</td></tr>)}</tbody></table></div> : !historyError && <p className="admin-demo-hint">No price history recorded.</p>}
      </section>
      <section className="admin-card products-table-card">
        <div className="admin-table-top"><div><h2>Stock movements · {selectedProduct.name}</h2><p>Recent adjustments, reservations, releases and fulfillment.</p></div></div>
        {movementHistory.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>RECORDED</th><th>REASON</th><th>ON-HAND Δ</th><th>RESERVED Δ</th></tr></thead><tbody>{movementHistory.map((movement) => <tr key={movement._id || movement.operationId}><td>{new Date(movement.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{movement.reason.replaceAll('_', ' ')}</td><td>{movement.deltaGrams > 0 ? '+' : ''}{formatWeight(movement.deltaGrams)}</td><td>{movement.reservedDeltaGrams > 0 ? '+' : ''}{formatWeight(movement.reservedDeltaGrams || 0)}</td></tr>)}</tbody></table></div> : !historyError && <p className="admin-demo-hint">No stock movements recorded.</p>}
      </section>
    </div>}
    <div className="admin-card products-table-card">
      <div className="admin-table-top">
        <div><h2>Public catalogue preview</h2><p>Only active products are shown to customers.</p></div>
        <span className="catalogue-count">{products.length} products</span>
      </div>
      {catalogueStatus !== 'ready'
        ? <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />
        : products.length
          ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>PRODUCT</th><th>PRICE / KG</th><th>AVAILABLE STOCK</th><th>AVAILABILITY</th><th>LIVE</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="table-product">{product.image && <img src={product.image} alt="" />}<span><b>{product.name}</b><small>{product.size} · {product.origin}</small></span></div></td><td>{product.pricePerKg === null ? 'Not set' : money(product.pricePerKg)}</td><td>{formatWeight(product.availableGrams)}</td><td><span className={product.stockKg < 3 ? 'stock-status low' : 'stock-status'}><i />{product.stockKg === 0 ? 'Out of stock' : product.stockKg < 3 ? 'Low stock' : 'In stock'}</span></td><td><span>{product.active ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody></table></div>
          : <CatalogueFeedback status="empty" />}
      <div className="admin-table-footer">Past orders keep their original prices.</div>
    </div>
  </>
}

function AdminOrders({ orders, selectedOrder, setSelectedOrder, onUpdateOrder, statusError, authToken }) {
  const current = orders.find((order) => order.id === selectedOrder?.id) || orders[0]
  const [deliveryEdits, setDeliveryEdits] = useState(null)
  const [eventsState, setEventsState] = useState({ orderId: '', events: [], error: '' })
  const [eventsRetry, setEventsRetry] = useState(0)
  useEffect(() => {
    if (!current?.rawId || !authToken) {
      return undefined
    }
    let active = true
    apiRequest(`/api/v1/orders/${encodeURIComponent(current.rawId)}/events`, { token: authToken })
      .then(({ data }) => {
        if (!active) return
        setEventsState({ orderId: current.rawId, events: data, error: '' })
      })
      .catch((error) => { if (active) setEventsState({ orderId: current.rawId, events: [], error: error.message || 'Could not load order history.' }) })
    return () => { active = false }
  }, [current?.rawId, authToken, eventsRetry])
  const orderEvents = eventsState.orderId === current?.rawId ? eventsState.events : []
  const eventsError = eventsState.orderId === current?.rawId ? eventsState.error : ''
  const deliveryForm = current
    ? deliveryEdits?.orderId === current.rawId
      ? deliveryEdits.fields
      : {
          method: current.delivery.method,
          personName: current.delivery.personName || '',
          personPhone: current.delivery.personPhone || '',
          serviceName: current.delivery.serviceName || '',
          reference: current.delivery.reference || '',
          details: current.delivery.details || '',
        }
    : { method: 'shop', personName: '', personPhone: '', serviceName: '', reference: '', details: '' }
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [recordingPayment, setRecordingPayment] = useState(false)
  const editDeliveryField = (field, value) => {
    if (!current) return
    setDeliveryEdits({
      orderId: current.rawId,
      fields: { ...deliveryForm, [field]: value },
    })
  }
  const updateOrder = async (id, patch) => {
    const updated = await onUpdateOrder(id, patch)
    if (updated) setEventsRetry((count) => count + 1)
    return updated
  }
  const deliveryStatusTransitions = {
    assigned: ['picked_up', 'in_transit', 'exception'],
    picked_up: ['in_transit', 'exception'],
    in_transit: ['exception'],
    exception: ['assigned', 'picked_up', 'in_transit'],
  }
  const saveDelivery = async (event) => {
    event.preventDefault()
    if (!current) return
    setSavingDelivery(true)
    await updateOrder(current.id, {
      deliveryAssignment: buildDeliveryAssignmentPayload(deliveryForm.method, deliveryForm),
    })
    setSavingDelivery(false)
  }
  const recordPaymentCollection = async () => {
    if (!current) return
    setRecordingPayment(true)
    try {
      await updateOrder(current.id, { paymentCollection: true })
    } finally {
      setRecordingPayment(false)
    }
  }
  return <>
    {statusError && <p className="form-error" role="alert">{statusError}</p>}
    <div className="admin-page-heading">
      <div><h1>Orders</h1><p>Review customer orders and update their status.</p></div>
    </div>
    <div className="orders-layout">
      <section className="admin-card orders-list-card">
          <div className="admin-card-heading"><h2>All orders</h2></div>
        {orders.length
          ? <div className="order-list">{orders.map((order) => <button key={order.rawId} onClick={() => setSelectedOrder(order)} className={`order-list-item ${current?.rawId === order.rawId ? 'selected' : ''}`}><span className="order-list-avatar">{order.customer.split(' ').map((word) => word[0]).join('')}</span><span className="order-list-main"><b>{order.customer}</b><small>{order.id} · {order.time}</small></span><span className="order-list-end"><b>{money(order.total)}</b><small className={`admin-status ${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</small></span></button>)}</div>
          : <p className="admin-demo-hint">No orders have been placed yet.</p>}
      </section>
      {current && <section className="admin-card order-detail-card">
        <div className="order-detail-heading"><div><span className="eyebrow">ORDER DETAILS</span><h2>{current.id}</h2></div><span className={`admin-status ${current.status.toLowerCase().replaceAll(' ', '-')}`}>{current.status}</span></div>
        <div className="order-detail-customer"><span className="order-list-avatar">{current.customer.split(' ').map((word) => word[0]).join('')}</span><span><b>{current.customer}</b><small>{current.phone}</small></span><a className="admin-text-button" href={`tel:${current.phone}`}>Contact</a></div>
        <div className="order-detail-address"><MapPin size={16} /><span><b>Delivery address</b><small>{current.address}</small></span></div>
        <div className="detail-products"><b>Items</b>{current.items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name}<small>{item.detail}</small></span><strong>{money(item.price)}</strong></div>)}</div>
        <section className="order-event-history admin-event-history" aria-labelledby="admin-order-history"><h3 id="admin-order-history">Order and delivery history</h3>{eventsError && <p className="form-error" role="alert">{eventsError}</p>}{orderEvents.length ? <ol>{orderEvents.map((item) => <li key={item.id}><b>{item.type.replaceAll('_', ' ')}</b><small>{item.actorRole}{item.from && item.to ? ` · ${item.from.replaceAll('_', ' ')} → ${item.to.replaceAll('_', ' ')}` : item.to ? ` · ${item.to.replaceAll('_', ' ')}` : ''}</small><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></li>)}</ol> : !eventsError && <p>No updates recorded yet.</p>}</section>
        <section className="admin-delivery-assignment" aria-labelledby="delivery-assignment-heading">
          <div className="admin-delivery-heading"><div><h3 id="delivery-assignment-heading">Delivery assignment</h3><p>Status: {deliveryStatusLabel(current.delivery.status)}</p></div><span className="admin-status">{current.delivery.method === 'third_party' ? 'Third party' : 'Shop delivery'}</span></div>
          <form className="admin-delivery-form" onSubmit={saveDelivery}>
            <label>Delivery method<select value={deliveryForm.method} onChange={(event) => editDeliveryField('method', event.target.value)}><option value="shop">Shop delivery person</option><option value="third_party">Third-party (manual)</option></select></label>
            {deliveryForm.method === 'shop'
              ? <div className="form-grid"><label>Delivery person name<input required minLength="2" maxLength="120" value={deliveryForm.personName} onChange={(event) => editDeliveryField('personName', event.target.value)} /></label><label>Contact number<input required type="tel" maxLength="32" value={deliveryForm.personPhone} onChange={(event) => editDeliveryField('personPhone', event.target.value)} /></label></div>
              : <><label>Service / method name<input required minLength="2" maxLength="100" value={deliveryForm.serviceName} onChange={(event) => editDeliveryField('serviceName', event.target.value)} placeholder="Manually entered; no provider connected" /></label><div className="form-grid"><label>Reference<input maxLength="120" value={deliveryForm.reference} onChange={(event) => editDeliveryField('reference', event.target.value)} /></label><label>Internal details<input maxLength="500" value={deliveryForm.details} onChange={(event) => editDeliveryField('details', event.target.value)} /></label></div></>}
            <button type="submit" className="button button-outline" disabled={savingDelivery}>{savingDelivery ? 'Saving…' : current.delivery.status === 'not_assigned' ? 'Save assignment' : 'Update assignment'}</button>
          </form>
          {current.delivery.method === 'shop' && current.delivery.personName && <p className="admin-delivery-current">Assigned to {current.delivery.personName} · {current.delivery.personPhone}</p>}
          {current.delivery.method === 'third_party' && <p className="admin-delivery-current">{[current.delivery.serviceName, current.delivery.reference, current.delivery.details].filter(Boolean).join(' · ') || 'No manual details recorded.'}</p>}
          {['preparing', 'out_for_delivery'].includes(current.rawStatus) && current.delivery.status !== 'not_assigned' && !['delivered', 'cancelled'].includes(current.delivery.status) && <label className="status-control">Delivery status<select value="" onChange={(event) => updateOrder(current.id, { deliveryStatus: event.target.value })}><option value="" disabled>Update delivery status…</option>{(deliveryStatusTransitions[current.delivery.status] || []).map((status) => <option key={status} value={status}>{deliveryStatusLabel(status)}</option>)}</select></label>}
        </section>
        <div className="order-detail-total"><span>Order total</span><b>{money(current.total)}</b></div>
        <section className="admin-delivery-assignment" aria-labelledby="order-payment-heading"><div className="admin-delivery-heading"><div><h3 id="order-payment-heading">Payment</h3><p>{current.paymentMethodLabel} · {current.paymentStatusLabel}</p></div>{current.paymentStatus === 'collected' && current.paymentCollectedAt && <span>{new Date(current.paymentCollectedAt).toLocaleDateString('en-IN')}</span>}</div>{current.rawStatus === 'delivered' && current.paymentStatus === 'pending_collection' && <button type="button" className="button button-outline" disabled={recordingPayment} onClick={recordPaymentCollection}>{recordingPayment ? 'Recording…' : 'Record payment collected'}</button>}</section>
        <label className="status-control">Order status<select value={current.status} onChange={(event) => updateOrder(current.id, { status: event.target.value })}><option>Pending</option><option>Confirmed</option><option>Processing</option><option>Out for delivery</option><option>Delivered</option><option>Cancelled</option></select></label>
        <p className="admin-demo-hint">Manual assignment only. Third-party dispatch, live tracking, and notifications are not connected. Assignment changes do not recalculate the order’s original delivery fee.</p>
      </section>}
    </div>
  </>
}

function NotFound() {
  return <main className="page-main not-found"><div className="empty-state"><Fish size={38} /><div className="eyebrow">OOPS, WRONG AISLE</div><h2>We couldn't find that page</h2><p>Let's get you back to the good stuff.</p><Link to="/" className="button button-dark">Back to home <ArrowRight size={16} /></Link></div></main>
}

export default App
