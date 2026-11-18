import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Banknote, Check, Clock3,
  Fish, Headset, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal,
  Sparkles, Truck, X,
} from 'lucide-react'
import { buildDeliveryAssignmentPayload, deliveryStatusLabel, toCustomerDelivery } from './delivery.js'
import './App.css'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
let latestAccessToken = ''
let authStateUpdater = () => {}
let refreshInFlight = null
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
    if (!refreshInFlight) {
      refreshInFlight = fetch(`${apiBase}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
        .then(async (refreshResponse) => {
          const refreshPayload = await refreshResponse.json().catch(() => null)
          if (!refreshResponse.ok || !refreshPayload?.data?.accessToken) {
            if (refreshResponse.status === 401) {
              latestAccessToken = ''
              authStateUpdater(null)
            }
            throw new Error(refreshPayload?.error?.message || `Session refresh failed (${refreshResponse.status}).`)
          }
          latestAccessToken = refreshPayload.data.accessToken
          authStateUpdater(refreshPayload.data)
          return latestAccessToken
        })
        .finally(() => { refreshInFlight = null })
    }
    response = await requestWithToken(await refreshInFlight)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status}).`)
  return payload
}

function toAdminOrder(order) {
  const statusLabels = {
    pending: 'New',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
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
    apiRequest('/api/v1/auth/refresh', { method: 'POST' })
      .then(({ data }) => {
        if (!active) return
        latestAccessToken = data.accessToken
        authStateUpdater(data)
        setAuthStatus('ready')
      })
      .catch(() => {
        if (!active) return
        latestAccessToken = ''
        authStateUpdater(null)
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
          ? 'Could not reach the product service. Check that the API and MongoDB are running, then try again.'
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
      setToast({ message: 'This selection is no longer available' })
      return
    }
    const key = `${product.id}-${cleaned ? 'cleaned' : 'whole'}-${weight}`
    setCart((items) => {
      const found = items.find((item) => item.key === key)
      if (found) return items.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      return [...items, { key, productId: product.id, cleaned, weight, quantity }]
    })
    setToast({ message: `${product.name} added to cart` })
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
      setToast({ message: error.message || 'Could not sign out. Please try again.' })
    }
  }

  return (
    <BrowserRouter>
      <div className="app-shell min-h-screen">
        <Announcement />
        <Header cartCount={cartCount} menuOpen={menuOpen} setMenuOpen={setMenuOpen} currentUser={currentUser} />
        <Routes>
          <Route path="/" element={<HomePage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
          <Route path="/shop" element={<ShopPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
          <Route path="/product/:id" element={<ProductPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} onAdd={addToCart} />} />
          <Route path="/cart" element={<CartPage cart={cart} products={products} onChange={updateQuantity} />} />
          <Route path="/account" element={<AccountPage currentUser={currentUser} authStatus={authStatus} onAuthenticated={onAuthenticated} onSignOut={signOut} />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} products={products} currentUser={currentUser} authToken={authToken} onPlaceOrder={(order) => { setActiveOrder(order); clearCart() }} />} />
          <Route path="/track" element={<TrackPage order={activeOrder} authToken={authToken} />} />
          <Route path="/admin/*" element={<AdminPage products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={retryCatalogue} currentUser={currentUser} authToken={authToken} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
        {toast && <div className="cart-toast" role="status" aria-live="polite"><span className="cart-toast-check"><Check size={16} /></span><span>{toast.message}</span><Link to="/cart" onClick={() => setToast(null)}>View cart</Link><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
      </div>
    </BrowserRouter>
  )
}

function Announcement() {
  return <div className="announcement"><span><Sparkles size={14} /> Fresh catch, delivered with care</span><span className="announcement-location"><MapPin size={13} /> Hyderabad only</span></div>
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
          <Link className="track-link" to="/track"><PackageCheck size={17} /> Track order</Link>
          <Link className="track-link account-nav" to="/account">{currentUser ? 'My account' : 'Sign in'}</Link>
          <Link to="/cart" className="cart-button" aria-label={`Cart, ${cartCount} items`}><ShoppingBag size={18} /><span>Cart</span><b>{cartCount}</b></Link>
        </div>
      </div>
    </header>
  )
}

function HomePage({ products, catalogueStatus, catalogueError, onRetry, onAdd }) {
  const featured = products.filter((product) => product.active).slice(0, 3)
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEIGHBOURHOOD PRAWN SHOP</div>
          <h1>Good prawns.<br /><em>Good food.</em><br />Good mood.</h1>
          <p>Freshly sourced prawns, cleaned just the way you like. At your door across Hyderabad.</p>
          <div className="hero-cta"><Link to="/shop" className="button button-dark">Shop fresh prawns <ArrowRight size={17} /></Link><span className="delivery-note"><Truck size={16} /> Same-day slots available</span></div>
          <div className="hero-rating"><div className="avatar-stack"><span>R</span><span>S</span><span>A</span><span>+</span></div><div><strong>Freshness you can taste</strong><small>Trusted by Hyderabad home cooks</small></div></div>
        </div>
        <div className="hero-visual">
          <img src="https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=1100&q=85" alt="Fresh prawns ready to be prepared" />
          <div className="hero-image-label"><span className="fresh-seal"><Fish size={20} /></span><span><strong>Fresh, not frozen</strong><small>Every order, every time</small></span></div>
          <div className="hero-scribble">from our shop<br />to your table <ArrowDownRight size={25} /></div>
        </div>
        <div className="hero-background-note" aria-hidden="true">FRESH CATCH</div>
      </section>

      <section className="trust-strip" aria-label="Our service highlights">
        <div><BadgeCheck /><span><b>Freshly sourced</b><small>Carefully picked daily</small></span></div>
        <div><Sparkles /><span><b>Cleaned your way</b><small>Cleaned or uncleaned</small></span></div>
        <div><Truck /><span><b>Hyderabad delivery</b><small>Our rider or delivery partner</small></span></div>
        <div><Headset /><span><b>Real human support</b><small>We're happy to help</small></span></div>
      </section>

      <section className="section-block popular-section">
        <SectionHeading eyebrow="THE GOOD STUFF" title="Straight from the sea" description="A few local favourites to get you started." action={<Link to="/shop" className="text-link">View all prawns <ArrowRight size={16} /></Link>} />
        {products.some((product) => product.sampleData) && <p className="catalogue-sample-note" role="note">Sample catalogue data for local development. Prices and stock are illustrative.</p>}
        {catalogueStatus !== 'ready'
          ? <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />
          : featured.length
            ? <div className="product-grid">{featured.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>
            : <CatalogueFeedback status="empty" />}
      </section>

      <section id="our-promise" className="promise-section">
        <div className="promise-photo"><img src="https://images.unsplash.com/photo-1579684947550-22e945225d9a?auto=format&fit=crop&w=1000&q=85" alt="A freshly prepared seafood dish" /><div className="photo-tag"><span>✳</span> GOOD FOOD STARTS HERE</div></div>
        <div className="promise-copy"><div className="eyebrow">A LITTLE ABOUT US</div><h2>Small shop.<br /><em>Big on fresh.</em></h2><p>We’re a single-owner neighbourhood prawn shop serving Hyderabad. That means each order gets personal attention, fair daily prices, and a little extra care.</p><ul className="promise-list"><li><Check size={16} /> Picked fresh, packed with care</li><li><Check size={16} /> Cleaned or uncleaned — your call</li><li><Check size={16} /> Clear pricing, no surprises</li></ul><Link to="/shop" className="button button-outline">Meet your next meal <ArrowRight size={16} /></Link></div>
      </section>

      <section className="quote-band"><span className="quote-mark">“</span><p>We believe the best meals begin with really good ingredients.</p><span className="quote-byline">FRESH PRAWNS ONLINE · HYDERABAD</span></section>
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
  const canQuickAdd = product.availableGrams >= 500
    && product.pricePerKg !== null
    && product.preparationOptions.some((option) => option.type === 'uncleaned' && option.enabled)
  return (
    <article className="product-card">
      <Link to={`/product/${product.id}`} className="product-photo">{product.image && <img src={product.image} alt={product.name} />}<span className="product-badge">{product.badge}</span><span className="quick-view"><Search size={15} /> Quick view</span></Link>
      <div className="product-card-body">
        <div className="product-meta"><span>{product.size}</span><span className={`availability ${product.availableGrams < 500 ? 'unavailable' : ''}`}><i />{product.availableGrams >= 500 ? 'In stock' : 'Unavailable'}</span></div>
        <h3><Link to={`/product/${product.id}`}>{product.name}</Link></h3>
        <p>{product.description}</p>
        <div className="product-card-bottom"><div><strong>{product.pricePerKg === null ? 'Price updating' : money(product.pricePerKg)}</strong>{product.pricePerKg !== null && <small> / kg</small>}</div><button className="icon-add" type="button" aria-label={`Add ${product.name} to cart`} disabled={!canQuickAdd} onClick={() => onAdd(product, false, 500)}><Plus size={19} /></button></div>
        <div className="product-card-hint">Add 500 g · uncleaned</div>
      </div>
    </article>
  )
}

function ShopPage({ products, catalogueStatus, catalogueError, onRetry, onAdd }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All prawns')
  const categories = ['All prawns', 'Small', 'Medium', 'Large']
  const visible = products.filter((p) => p.active && p.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'All prawns' || p.size.toLowerCase() === filter.toLowerCase()))
  return <main className="page-main"><div className="page-title-row"><div><div className="eyebrow">FROM OUR COUNTER TO YOUR KITCHEN</div><h1>Shop prawns</h1><p>Fresh picks for whatever you're cooking up.</p></div><span className="catalogue-count">{products.filter((product) => product.active).length} fresh picks</span></div>
    {products.some((product) => product.sampleData) && <p className="catalogue-sample-note" role="note">Sample catalogue data for local development. Prices and stock are illustrative.</p>}
    <div className="catalogue-tools"><div className="filter-pills" role="group" aria-label="Filter by prawn size">{categories.map((category) => <button key={category} className={filter === category ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter(category)} type="button">{category}</button>)}</div><label className="search-box"><Search size={17} /><span className="sr-only">Search prawns</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your prawns..." /></label></div>
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
  return <main className="page-main detail-page"><Link to="/shop" className="back-link"><ArrowLeft size={16} /> Back to all prawns</Link>{product.sampleData && <p className="catalogue-sample-note" role="note">Sample product and pricing data for local development.</p>}<div className="detail-layout"><div className="detail-image">{product.image && <img src={product.image} alt={product.name} />}<span className="product-badge">{product.badge}</span><div className="image-caption"><BadgeCheck size={16} /> Freshly sourced for today's orders</div></div><div className="detail-info"><div className="eyebrow">{product.size} · {product.origin}</div><h1>{product.name}</h1><p className="detail-description">{product.longDescription || product.description}</p><div className="detail-price">{product.pricePerKg === null ? 'Price updating' : <>{money(product.pricePerKg)} <small>/ kg</small></>}<span className="price-date"><Clock3 size={13} /> Current shop price</span></div>
      <div className="option-group"><div className="option-heading"><b>How would you like them?</b><span>Choose your prep</span></div><div className="prep-options"><button type="button" disabled={!uncleanedOption} onClick={() => setCleaned(false)} className={`prep-option ${!cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Uncleaned</b><small>As they come, fresh & whole</small></span><strong>Included</strong></button><button type="button" disabled={!cleanedOption} onClick={() => setCleaned(true)} className={`prep-option ${cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Cleaned</b><small>Deveined & ready to cook</small></span><strong>+{money(product.cleaningFee)}</strong></button></div></div>
      <div className="option-group"><div className="option-heading"><b>Pick your weight</b><span>{product.availableGrams ? `${formatWeight(product.availableGrams)} available` : 'Currently out of stock'}</span></div><div className="weight-options">{[250, 500, 1000].map((grams) => <button key={grams} type="button" disabled={grams > product.availableGrams} className={`weight-option ${weight === grams ? 'selected' : ''}`} onClick={() => { setWeight(grams); setQuantity(Math.min(quantity, Math.floor(product.availableGrams / grams))) }}>{grams >= 1000 ? '1 kg' : `${grams} g`}</button>)}</div></div>
      <div className="detail-buy-row"><div className="quantity-picker"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus size={15} /></button><span>{quantity}</span><button type="button" aria-label="Increase quantity" disabled={quantity >= maxQuantity} onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}><Plus size={15} /></button></div><button type="button" className="button button-dark add-to-cart" disabled={!maxQuantity || !price || (cleaned && !cleanedOption) || (!cleaned && !uncleanedOption)} onClick={handleAdd}><ShoppingBag size={17} /> {price === null ? 'Price unavailable' : !maxQuantity ? 'Out of stock' : <>Add to cart · {money(price)}</>}</button></div>
      <div className="detail-delivery-note"><Truck size={17} /><span><b>Delivery across Hyderabad</b><small>Choose a delivery option at checkout · from ₹{deliveryFee}</small></span></div>
    </div></div><section className="detail-bottom-note"><span>✳</span> Product, current price, preparation options and available weight are loaded from the shop API.</section></main>
}

function getLinePrice(item, product) {
  return (product.pricePerKg * item.weight / 1000 + (item.cleaned ? product.cleaningFee : 0)) * item.quantity
}

function CartPage({ cart, products, onChange }) {
  const lines = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) })).filter((item) => item.product)
  const subtotal = lines.reduce((sum, item) => sum + getLinePrice(item, item.product), 0)
  return <main className="page-main"><div className="eyebrow">YOUR LITTLE PRAWN HAUL</div><h1 className="page-heading">Your cart</h1>{!lines.length ? <div className="empty-state cart-empty"><ShoppingBag size={36} /><h2>Nothing in your basket yet</h2><p>Your next delicious meal is just a few clicks away.</p><Link to="/shop" className="button button-dark">Browse fresh prawns <ArrowRight size={16} /></Link></div> : <div className="cart-layout"><section className="cart-items"><div className="cart-column-heading"><span>ITEM</span><span>QUANTITY</span><span>SUBTOTAL</span></div>{lines.map((item) => <article className="cart-item" key={item.key}><Link to={`/product/${item.product.id}`} className="cart-item-image"><img src={item.product.image} alt="" /></Link><div className="cart-item-info"><Link to={`/product/${item.product.id}`}><b>{item.product.name}</b></Link><small>{item.cleaned ? 'Cleaned' : 'Uncleaned'} · {item.weight >= 1000 ? '1 kg' : `${item.weight} g`}</small><span>{money(item.product.pricePerKg)} / kg</span><button type="button" className="remove-link" onClick={() => onChange(item.key, -item.quantity)}>Remove</button></div><div className="quantity-picker cart-quantity"><button aria-label={`Decrease ${item.product.name} quantity`} onClick={() => onChange(item.key, -1)}><Minus size={14} /></button><span>{item.quantity}</span><button aria-label={`Increase ${item.product.name} quantity`} onClick={() => onChange(item.key, 1)}><Plus size={14} /></button></div><strong className="cart-line-price">{money(getLinePrice(item, item.product))}</strong></article>)}
      <Link className="continue-shopping" to="/shop"><ArrowLeft size={16} /> Keep browsing</Link></section><aside className="order-summary"><h2>Order summary</h2><div className="summary-row"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Delivery</span><span>Calculated next</span></div><div className="summary-total"><span>Total</span><strong>{money(subtotal)}</strong></div><p className="summary-disclaimer">Delivery fee and address are confirmed at checkout.</p><Link to="/checkout" className="button button-dark full-button">Continue to checkout <ArrowRight size={17} /></Link><div className="secure-note"><BadgeCheck size={15} /> No payment is collected in this demo</div></aside></div>}</main>
}

function AccountPage({ currentUser, authStatus, onAuthenticated, onSignOut }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
    return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">YOUR FRESH PRAWNS ACCOUNT</div><h1>You're signed in</h1><p>{currentUser.email}</p><p className="account-role">Account type: {currentUser.role}</p><div className="account-actions"><Link className="button button-dark" to={currentUser.role === 'admin' ? '/admin' : '/shop'}>{currentUser.role === 'admin' ? 'Open admin orders' : 'Continue shopping'} <ArrowRight size={16} /></Link><button className="button button-outline" type="button" onClick={onSignOut}>Sign out</button></div></div></main>
  }

  return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">A SEAT AT OUR TABLE</div><h1>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h1><p>{mode === 'register' ? 'Sign up to place and view your Hyderabad orders.' : 'Sign in to continue to checkout and your orders.'}</p><div className="account-mode" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button></div><form className="account-form" onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" maxLength="254" required /></label><label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength="12" maxLength="128" required /><small>Use at least 12 characters.</small></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-dark full-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create customer account' : 'Sign in'} <ArrowRight size={16} /></button></form><p className="account-note">Registration creates a customer account. Admin access is provisioned separately by the shop owner.</p></div></main>
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
  return <main className="page-main"><Link to="/cart" className="back-link"><ArrowLeft size={16} /> Back to cart</Link><div className="eyebrow">ALMOST THE GOOD PART</div><h1 className="page-heading">Checkout</h1><div className="checkout-layout"><form className="checkout-form" onSubmit={submit} onChange={() => { idempotencyKeyRef.current = null }}><section className="checkout-panel"><div className="form-section-title"><span>01</span><div><h2>Your details</h2><p>We'll use these to coordinate your delivery.</p></div></div><div className="form-grid"><label>Full name<input name="name" autoComplete="name" placeholder="e.g. Ananya Rao" required /></label><label>Mobile number<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" required /></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>02</span><div><h2>Where should we deliver?</h2><p>Hyderabad delivery. Map and live location remain future integrations.</p></div></div><label className="full-label">Delivery address<textarea name="address" autoComplete="street-address" rows="3" placeholder="House / flat, street, Hyderabad" required /></label><div className="form-grid"><label>Area / locality<input name="locality" autoComplete="address-level2" placeholder="e.g. Banjara Hills" required /></label><label>PIN code<input name="postalCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="500034" required /></label></div><div className="location-placeholder"><div className="location-pin"><MapPin size={19} /></div><div><b>Choose a delivery location</b><small>Map and live location will be available in a future phase.</small></div><button type="button" className="location-disabled" disabled>Map coming soon</button></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>03</span><div><h2>How should we get it to you?</h2><p>Choose a delivery method; no delivery provider is connected.</p></div></div><div className="delivery-options"><label className={`delivery-choice ${deliveryMethod === 'shop' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'shop'} onChange={() => setDeliveryMethod('shop')} /><span className="delivery-icon"><Truck size={20} /></span><span><b>Our delivery person</b><small>Personal local delivery</small></span><strong>₹40 est.</strong></label><label className={`delivery-choice ${deliveryMethod === 'third_party' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'third_party'} onChange={() => setDeliveryMethod('third_party')} /><span className="delivery-icon"><PackageCheck size={20} /></span><span><b>Delivery partner</b><small>Third-party service · not connected</small></span><strong>₹60 est.</strong></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>04</span><div><h2>Payment</h2><p>Payment collection isn't enabled for this demo.</p></div></div><div className="payment-placeholder"><Banknote size={19} /><span><b>Pay at delivery</b><small>Placeholder only — no payment is processed.</small></span><span className="demo-tag">DEMO</span></div></section>
      {submitError && <p className="form-error" role="alert">{submitError}</p>}<button type="submit" disabled={submitting} className="button button-dark full-button place-order">{submitting ? 'Placing order…' : `Place order · ${money(total)} est.`} <ArrowRight size={17} /></button><p className="checkout-legal">The API recalculates all prices and reserves stock. Payment and delivery integrations are not enabled.</p></form>
    <aside className="order-summary checkout-summary"><h2>Your order</h2>{lines.map((item) => <div className="summary-product" key={item.key}><img src={item.product.image} alt="" /><span><b>{item.product.name}</b><small>{item.cleaned ? 'Cleaned' : 'Uncleaned'} · {item.weight >= 1000 ? '1 kg' : `${item.weight} g`} × {item.quantity}</small></span><strong>{money(getLinePrice(item, item.product))}</strong></div>)}<div className="summary-row"><span>Subtotal estimate</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Delivery estimate</span><b>{money(delivery)}</b></div><div className="summary-total"><span>Total estimate</span><strong>{money(total)}</strong></div><div className="checkout-summary-note"><BadgeCheck size={15} /> Final total is calculated by the server</div></aside></div></main>
}

function TrackPage({ order, authToken }) {
  const [searchParams] = useSearchParams()
  const [lookup, setLookup] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [foundOrder, setFoundOrder] = useState(null)
  const [lookupError, setLookupError] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const orderId = searchParams.get('order')
  const [loadedOrder, setLoadedOrder] = useState(null)
  useEffect(() => {
    if (!orderId || !authToken) return undefined
    let active = true
    apiRequest(`/api/v1/orders/${encodeURIComponent(orderId)}`, { token: authToken })
      .then(({ data }) => {
        if (!active) return
        setLoadedOrder(toCustomerOrder(data))
      })
      .catch((error) => { if (active) setLookupError(error.message || 'Could not load this order.') })
    return () => { active = false }
  }, [orderId, authToken])
  const shownOrder = hasSearched ? foundOrder : (order?.orderId === orderId ? order : loadedOrder || order)
  const searchOrders = async (event) => {
    event.preventDefault()
    setHasSearched(true)
    setLookupError('')
    if (!authToken) {
      setLookupError('Sign in to find your orders.')
      return
    }
    setLookupBusy(true)
    try {
      const { data } = await apiRequest('/api/v1/orders', { token: authToken })
      const match = data.find((item) => item.id.toLowerCase() === lookup.trim().toLowerCase()
        || `fp-${item.id.slice(-6)}`.toLowerCase() === lookup.trim().toLowerCase())
      if (!match) {
        setFoundOrder(null)
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
  const steps = ['Confirmed', 'Preparing', 'Out for delivery', 'Delivered']
  const statusSteps = { pending: 0, confirmed: 0, preparing: 1, out_for_delivery: 2, delivered: 3 }
  const stage = statusSteps[shownOrder?.status] ?? statusSteps[String(shownOrder?.status || '').toLowerCase()] ?? -1
  return <main className="page-main tracking-page"><div className="eyebrow">A LITTLE PEACE OF MIND</div><h1 className="page-heading">Track your order</h1><p className="tracking-intro">We'll keep you in the loop, from our counter to your door.</p>
    <form className="tracking-search" onSubmit={searchOrders}><label htmlFor="order-lookup">Order number</label><div><input id="order-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="e.g. FP-123456" /><button className="button button-dark" type="submit" disabled={lookupBusy}>{lookupBusy ? 'Searching…' : 'Find order'} <ArrowRight size={16} /></button></div><small>Search uses orders linked to your signed-in account.</small></form>
    {lookupError && <p className="form-error" role="alert">{lookupError}</p>}
    {shownOrder ? <section className="tracking-card"><div className="tracking-card-head"><div><span className="status-pill"><i /> {shownOrder.status === 'pending' ? 'Order received' : shownOrder.status}</span><h2>Order {shownOrder.id}</h2><p>Placed {shownOrder.createdAt}</p></div><strong>{money(shownOrder.total)}</strong></div><div className="tracking-steps">{steps.map((step, index) => <div className={`tracking-step ${index <= stage ? 'completed' : ''}`} key={step}><span className="tracking-step-icon">{index <= stage ? <Check size={15} /> : index === 1 ? <Fish size={15} /> : index === 2 ? <Truck size={15} /> : <PackageCheck size={15} />}</span><b>{step}</b>{index < steps.length - 1 && <span className="tracking-step-line" />}</div>)}</div><div className="tracking-order-meta"><div><MapPin size={16} /><span><b>Delivering to</b><small>{shownOrder.address || 'Hyderabad'}</small></span></div><div><Truck size={16} /><span><b>Delivery method</b><small>{shownOrder.deliveryMethod === 'partner' ? 'Third-party service' : 'Our delivery person'}</small></span></div><div><PackageCheck size={16} /><span><b>Delivery status</b><small>{deliveryStatusLabel(shownOrder.delivery?.status)}</small></span></div>{shownOrder.delivery?.method === 'shop' && shownOrder.delivery.personName && <div><Headset size={16} /><span><b>Delivery contact</b><small>{shownOrder.delivery.personName}{shownOrder.delivery.personPhone ? ` · ${shownOrder.delivery.personPhone}` : ''}</small></span></div>}{shownOrder.delivery?.method === 'third_party' && (shownOrder.delivery.serviceName || shownOrder.delivery.reference) && <div><PackageCheck size={16} /><span><b>Delivery reference</b><small>{[shownOrder.delivery.serviceName, shownOrder.delivery.reference].filter(Boolean).join(' · ')}</small></span></div>}</div><p className="tracking-demo">Order and manual delivery updates are loaded from the API. Live location and provider updates are not connected.</p></section> : <div className="tracking-empty"><div className="tracking-empty-icon"><PackageCheck size={29} /></div><h2>No order to show just yet</h2><p>Place an order while signed in, or search for an order linked to your account.</p><Link to="/shop" className="text-link">Browse fresh prawns <ArrowRight size={16} /></Link></div>}
    <div className="tracking-support"><Headset size={18} /><span>Need a hand? <a href="tel:+914040001234">Call our shop at +91 40 4000 1234</a></span></div>
  </main>
}

function SupportSection() {
  return <section id="contact" className="support-section"><div className="support-icon"><Headset size={24} /></div><div><div className="eyebrow">WE'RE RIGHT HERE</div><h2>Questions? Let's talk.</h2><p>Our little shop is always happy to help with your order.</p></div><div className="support-actions"><a className="button button-dark" href="tel:+914040001234">Call the shop <ArrowRight size={16} /></a><span>+91 40 4000 1234 · Hyderabad</span></div></section>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><Link to="/" className="brand footer-brand"><span className="brand-mark"><Fish size={21} /></span><span className="brand-name">fresh<span>prawns</span><small>ONLINE · HYDERABAD</small></span></Link><p>Good prawns, good food, good mood.<br />A neighbourhood shop, with a little more convenience.</p><div className="footer-links"><Link to="/shop">Shop</Link><Link to="/track">Track order</Link><Link to="/admin">Admin demo</Link></div></div><div className="footer-bottom"><span>© 2026 Fresh Prawns Online · Sample storefront for Phase 1</span><span>Made with care in Hyderabad <span className="footer-heart">♥</span></span></div></footer>
}

function AdminPage({ products, catalogueStatus, catalogueError, onRetry, currentUser, authToken }) {
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
    apiRequest('/api/v1/orders', { token: authToken })
      .then(({ data }) => {
        if (!active) return
        const mapped = data.map(toAdminOrder)
        setOrders(mapped)
        setSelectedOrder((previous) => mapped.find((order) => order.rawId === previous?.rawId) || mapped[0] || null)
        setOrdersStatus(mapped.length ? 'ready' : 'empty')
        setOrdersError('')
      })
      .catch((error) => {
        if (!active) return
        setOrdersError(error.message || 'Could not load orders.')
        setOrdersStatus('error')
      })
    return () => { active = false }
  }, [currentUser, authToken, ordersRetry])

  const updateOrder = async (displayId, patch) => {
    const order = orders.find((item) => item.id === displayId)
    if (!order) return false
    let path
    let body
    if (patch.status) {
      const statusValues = {
        New: 'pending',
        Confirmed: 'confirmed',
        Preparing: 'preparing',
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

  if (!currentUser) return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">SHOP ADMIN</div><h1>Administrator sign-in required</h1><p>Admin access is verified by the API. Create the first admin account using the server’s secure setup command.</p><Link className="button button-dark" to="/account" state={{ from: '/admin' }}>Sign in <ArrowRight size={16} /></Link></div></main>
  if (currentUser.role !== 'admin') return <main className="page-main account-page"><div className="account-card"><div className="eyebrow">SHOP ADMIN</div><h1>Administrator access only</h1><p>This customer account cannot open the shop dashboard.</p><Link className="button button-outline" to="/">Back to storefront</Link></div></main>

  return <main className="admin-page"><aside className="admin-sidebar"><Link to="/" className="admin-brand"><span className="brand-mark"><Fish size={21} /></span><span>Fresh Prawns<small>SHOP ADMIN</small></span></Link><div className="admin-side-label">WORKSPACE</div><nav aria-label="Admin navigation">{tabs.map((item) => <button className={tab === item.id ? 'admin-nav-item active' : 'admin-nav-item'} key={item.id} onClick={() => setTab(item.id)} type="button">{item.id === 'overview' ? <SlidersHorizontal size={17} /> : item.id === 'products' ? <Fish size={17} /> : <PackageCheck size={17} />}{item.label}{item.id === 'orders' && <span className="nav-count">{orders.length}</span>}</button>)}</nav><div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><span><b>{currentUser.email}</b><small>Shop administrator</small></span></div></aside><div className="admin-content"><div className="admin-topbar"><div className="admin-breadcrumb">Workspace <span>/</span> <b>{tabs.find((item) => item.id === tab)?.label}</b></div><Link to="/" className="view-store-link"><ArrowLeft size={14} /> View storefront</Link></div><div className="admin-main-content">{tab === 'overview' && <AdminOverview products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={onRetry} orders={orders} setTab={setTab} />}{tab === 'products' && <AdminProducts products={products} catalogueStatus={catalogueStatus} catalogueError={catalogueError} onRetry={onRetry} />}{tab === 'orders' && <><AdminOrders orders={orders} selectedOrder={selectedOrder} setSelectedOrder={setSelectedOrder} onUpdateOrder={updateOrder} statusError={statusError} />{ordersStatus === 'loading' && <div role="status">Loading orders…</div>}{ordersStatus === 'error' && <div role="alert" className="form-error">{ordersError}<button type="button" onClick={() => { setOrdersStatus('loading'); setOrdersRetry((count) => count + 1) }}> Try again</button></div>}</>}</div></div></main>
}

function AdminOverview({ products, catalogueStatus, catalogueError, onRetry, orders, setTab }) {
  const revenue = orders.reduce((sum, order) => sum + order.total, 0)
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <div className="eyebrow">TODAY · HYDERABAD</div>
          <h1>Good morning, shop owner <span>✳</span></h1>
          <p>Recent orders and current catalogue data from the API.</p>
        </div>
        <span className="demo-badge"><span /> API DATA</span>
      </div>
      <div className="metric-grid">
        <Metric label="Recent order value" value={money(revenue)} change="latest orders" icon={<Banknote />} />
        <Metric label="Recent orders" value={orders.length} change="latest API results" icon={<PackageCheck />} />
        <Metric label="Active products" value={products.filter((product) => product.active).length} change={`${products.length} in catalogue`} icon={<Fish />} />
        <Metric label="Avg. order value" value={money(orders.length ? revenue / orders.length : 0)} change="latest order average" icon={<ArrowDownRight />} />
      </div>
      <div className="admin-overview-grid">
        <section className="admin-card sales-card">
          <div className="admin-card-heading">
            <div><h2>Sales overview</h2><p>Daily sales · sample data</p></div>
            <select aria-label="Sales chart period" defaultValue="7 days"><option>7 days</option><option>30 days</option></select>
          </div>
          <div className="sales-chart" role="img" aria-label="Sample sales trend chart">
            <div className="chart-y-labels"><span>₹8k</span><span>₹6k</span><span>₹4k</span><span>₹2k</span><span>₹0</span></div>
            <div className="chart-area">
              <div className="chart-grid"><i /><i /><i /><i /><i /></div>
              <div className="chart-bars">{[48, 62, 42, 75, 58, 88, 70].map((height, index) => <div className="chart-bar-column" key={index}><span className="chart-bar" style={{ height: `${height}%` }} title={`Sample sales: ${money(height * 86)}`} /><small>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</small></div>)}</div>
            </div>
          </div>
          <div className="chart-legend"><i /> Sales <span>Illustrative data only</span></div>
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <div><h2>Recent orders</h2><p>Latest activity from the shop</p></div>
            <button className="admin-text-button" onClick={() => setTab('orders')}>View all <ArrowRight size={14} /></button>
          </div>
          <div className="recent-orders">{orders.slice(0, 4).map((order) => <button className="recent-order" key={order.id} onClick={() => setTab('orders')}><span className="order-mini-icon"><ShoppingBag size={16} /></span><span><b>{order.id}</b><small>{order.customer} · {order.time}</small></span><span className={`admin-status ${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span></button>)}</div>
        </section>
      </div>
      <div className="admin-card stock-glance">
        <div className="admin-card-heading">
          <div><h2>Stock at a glance</h2><p>Ready to sell by weight</p></div>
          <button className="admin-text-button" onClick={() => setTab('products')}>Manage stock <ArrowRight size={14} /></button>
        </div>
        {catalogueStatus !== 'ready' && <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />}
        {catalogueStatus === 'ready' && (products.length ? <StockGlance products={products} /> : <CatalogueFeedback status="empty" />)}
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

function Metric({ label, value, change, icon }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong><span className="metric-change">{change}</span></div>
}

function AdminProducts({ products, catalogueStatus, catalogueError, onRetry }) {
  return <>
    <div className="admin-page-heading">
      <div><div className="eyebrow">YOUR CATCH, YOUR CALL</div><h1>Products & daily pricing</h1><p>Catalogue, current price and available stock are loaded from the API.</p></div>
      <button className="button button-dark admin-add-product" type="button" disabled><Plus size={16} /> Add product</button>
    </div>
    <div className="admin-card products-table-card">
      <div className="admin-table-top">
        <div><h2>Product catalogue</h2><p>Read-only in this stage. Product and stock editing remain future work.</p></div>
        <span className="catalogue-count">{products.length} products</span>
      </div>
      {catalogueStatus !== 'ready'
        ? <CatalogueFeedback status={catalogueStatus} error={catalogueError} onRetry={onRetry} />
        : products.length
          ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>PRODUCT</th><th>PRICE / KG</th><th>AVAILABLE STOCK</th><th>AVAILABILITY</th><th>LIVE</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="table-product">{product.image && <img src={product.image} alt="" />}<span><b>{product.name}</b><small>{product.size} · {product.origin}</small></span></div></td><td>{product.pricePerKg === null ? 'Not set' : money(product.pricePerKg)}</td><td>{formatWeight(product.availableGrams)}</td><td><span className={product.stockKg < 3 ? 'stock-status low' : 'stock-status'}><i />{product.stockKg === 0 ? 'Out of stock' : product.stockKg < 3 ? 'Low stock' : 'In stock'}</span></td><td><span>{product.active ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody></table></div>
          : <CatalogueFeedback status="empty" />}
      <div className="admin-table-footer"><Sparkles size={15} /> Product, daily pricing, and stock write APIs are not enabled in this stage.</div>
    </div>
    <div className="admin-info-note"><BadgeCheck size={17} /><span><b>Public catalogue data.</b> Price and available weight reflect the current API response; editing is intentionally disabled.</span></div>
  </>
}

function AdminOrders({ orders, selectedOrder, setSelectedOrder, onUpdateOrder, statusError }) {
  const current = orders.find((order) => order.id === selectedOrder?.id) || orders[0]
  const [deliveryEdits, setDeliveryEdits] = useState(null)
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
  const editDeliveryField = (field, value) => {
    if (!current) return
    setDeliveryEdits({
      orderId: current.rawId,
      fields: { ...deliveryForm, [field]: value },
    })
  }
  const updateOrder = (id, patch) => onUpdateOrder(id, patch)
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
  return <>
    {statusError && <p className="form-error" role="alert">{statusError}</p>}
    <div className="admin-page-heading">
      <div><div className="eyebrow">THE GOOD STUFF IS MOVING</div><h1>Orders</h1><p>Recent orders from the API. Status changes are checked by the server.</p></div>
      <span className="demo-badge"><span /> {orders.length} ORDERS</span>
    </div>
    <div className="orders-layout">
      <section className="admin-card orders-list-card">
        <div className="admin-card-heading"><div><h2>All orders</h2><p>Select an order to view details</p></div></div>
        {orders.length
          ? <div className="order-list">{orders.map((order) => <button key={order.rawId} onClick={() => setSelectedOrder(order)} className={`order-list-item ${current?.rawId === order.rawId ? 'selected' : ''}`}><span className="order-list-avatar">{order.customer.split(' ').map((word) => word[0]).join('')}</span><span className="order-list-main"><b>{order.customer}</b><small>{order.id} · {order.time}</small></span><span className="order-list-end"><b>{money(order.total)}</b><small className={`admin-status ${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</small></span></button>)}</div>
          : <p className="admin-demo-hint">No orders have been placed yet.</p>}
      </section>
      {current && <section className="admin-card order-detail-card">
        <div className="order-detail-heading"><div><span className="eyebrow">ORDER DETAILS</span><h2>{current.id}</h2></div><span className={`admin-status ${current.status.toLowerCase().replaceAll(' ', '-')}`}>{current.status}</span></div>
        <div className="order-detail-customer"><span className="order-list-avatar">{current.customer.split(' ').map((word) => word[0]).join('')}</span><span><b>{current.customer}</b><small>{current.phone}</small></span><a className="admin-text-button" href={`tel:${current.phone}`}>Contact</a></div>
        <div className="order-detail-address"><MapPin size={16} /><span><b>Delivery address</b><small>{current.address}</small></span></div>
        <div className="detail-products"><b>Items</b>{current.items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name}<small>{item.detail}</small></span><strong>{money(item.price)}</strong></div>)}</div>
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
        <label className="status-control">Order status<select value={current.status} onChange={(event) => updateOrder(current.id, { status: event.target.value })}><option>New</option><option>Confirmed</option><option>Preparing</option><option>Out for delivery</option><option>Delivered</option><option>Cancelled</option></select></label>
        <p className="admin-demo-hint">Manual assignment only. Third-party dispatch, live tracking, and notifications are not connected. Assignment changes do not recalculate the order’s original delivery fee.</p>
      </section>}
    </div>
  </>
}

function NotFound() {
  return <main className="page-main not-found"><div className="empty-state"><Fish size={38} /><div className="eyebrow">OOPS, WRONG AISLE</div><h2>We couldn't find that page</h2><p>Let's get you back to the good stuff.</p><Link to="/" className="button button-dark">Back to home <ArrowRight size={16} /></Link></div></main>
}

export default App
