import { useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Banknote, Check, Clock3,
  Fish, Headset, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal,
  Sparkles, Truck, X,
} from 'lucide-react'
import { initialProducts, sampleOrders } from './data'
import './App.css'

const money = (amount) => `₹${Math.round(amount).toLocaleString('en-IN')}`
const deliveryFee = 40

function App() {
  const [products, setProducts] = useState(initialProducts)
  const [cart, setCart] = useState([])
  const [activeOrder, setActiveOrder] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const addToCart = (product, cleaned, weight, quantity = 1) => {
    const key = `${product.id}-${cleaned ? 'cleaned' : 'whole'}-${weight}`
    setCart((items) => {
      const found = items.find((item) => item.key === key)
      if (found) return items.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      return [...items, { key, productId: product.id, cleaned, weight, quantity }]
    })
    setToast({ message: `${product.name} added to cart` })
  }

  const updateQuantity = (key, change) => setCart((items) => items
    .map((item) => item.key === key ? { ...item, quantity: item.quantity + change } : item)
    .filter((item) => item.quantity > 0))

  const clearCart = () => setCart([])
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0)

  const updateProduct = (id, patch) => setProducts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))

  return (
    <BrowserRouter>
      <div className="app-shell min-h-screen">
        <Announcement />
        <Header cartCount={cartCount} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
        <Routes>
          <Route path="/" element={<HomePage products={products} onAdd={addToCart} />} />
          <Route path="/shop" element={<ShopPage products={products} onAdd={addToCart} />} />
          <Route path="/product/:id" element={<ProductPage products={products} onAdd={addToCart} />} />
          <Route path="/cart" element={<CartPage cart={cart} products={products} onChange={updateQuantity} />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} products={products} onPlaceOrder={(order) => { setActiveOrder(order); clearCart() }} />} />
          <Route path="/track" element={<TrackPage order={activeOrder} />} />
          <Route path="/admin/*" element={<AdminPage products={products} updateProduct={updateProduct} />} />
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

function Header({ cartCount, menuOpen, setMenuOpen }) {
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
          <Link to="/cart" className="cart-button" aria-label={`Cart, ${cartCount} items`}><ShoppingBag size={18} /><span>Cart</span><b>{cartCount}</b></Link>
        </div>
      </div>
    </header>
  )
}

function HomePage({ products, onAdd }) {
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
        <div className="product-grid">
          {featured.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}
        </div>
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

function ProductCard({ product, onAdd }) {
  return (
    <article className="product-card">
      <Link to={`/product/${product.id}`} className="product-photo"><img src={product.image} alt={product.name} /><span className="product-badge">{product.badge}</span><span className="quick-view"><Search size={15} /> Quick view</span></Link>
      <div className="product-card-body">
        <div className="product-meta"><span>{product.size}</span><span className="availability"><i /> In stock</span></div>
        <h3><Link to={`/product/${product.id}`}>{product.name}</Link></h3>
        <p>{product.description}</p>
        <div className="product-card-bottom"><div><strong>{money(product.pricePerKg)}</strong><small> / kg</small></div><button className="icon-add" type="button" aria-label={`Add ${product.name} to cart`} onClick={() => onAdd(product, false, 500)}><Plus size={19} /></button></div>
        <div className="product-card-hint">Add 500 g · uncleaned</div>
      </div>
    </article>
  )
}

function ShopPage({ products, onAdd }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All prawns')
  const categories = ['All prawns', 'Small', 'Medium', 'Large']
  const visible = products.filter((p) => p.active && p.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'All prawns' || p.size.toLowerCase() === filter.toLowerCase()))
  return <main className="page-main"><div className="page-title-row"><div><div className="eyebrow">FROM OUR COUNTER TO YOUR KITCHEN</div><h1>Shop prawns</h1><p>Fresh picks for whatever you're cooking up.</p></div><span className="catalogue-count">{products.filter((product) => product.active).length} fresh picks</span></div>
    <div className="catalogue-tools"><div className="filter-pills" role="group" aria-label="Filter by prawn size">{categories.map((category) => <button key={category} className={filter === category ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter(category)} type="button">{category}</button>)}</div><label className="search-box"><Search size={17} /><span className="sr-only">Search prawns</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your prawns..." /></label></div>
    {visible.length ? <div className="product-grid catalogue-grid">{visible.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div> : <div className="empty-state"><Fish size={34} /><h2>No prawns found</h2><p>Try another name or size filter.</p><button className="button button-outline" onClick={() => { setFilter('All prawns'); setSearch('') }}>Clear filters</button></div>}
    <div className="catalogue-note"><Sparkles size={17} /> Prices are per kg and may change with the day's fresh catch. Your cart uses today's sample prices.</div>
  </main>
}

function ProductPage({ products, onAdd }) {
  const { id } = useParams()
  const product = products.find((item) => item.id === id && item.active)
  const [cleaned, setCleaned] = useState(true)
  const [weight, setWeight] = useState(500)
  const [quantity, setQuantity] = useState(1)
  if (!product) return <NotFound />
  const prepFee = cleaned ? product.cleaningFee : 0
  const price = (product.pricePerKg * weight / 1000 + prepFee) * quantity
  const handleAdd = () => onAdd(product, cleaned, weight, quantity)
  return <main className="page-main detail-page"><Link to="/shop" className="back-link"><ArrowLeft size={16} /> Back to all prawns</Link><div className="detail-layout"><div className="detail-image"><img src={product.image} alt={product.name} /><span className="product-badge">{product.badge}</span><div className="image-caption"><BadgeCheck size={16} /> Freshly sourced for today's orders</div></div><div className="detail-info"><div className="eyebrow">{product.size} · {product.origin}</div><h1>{product.name}</h1><p className="detail-description">{product.longDescription}</p><div className="detail-price">{money(product.pricePerKg)} <small>/ kg</small><span className="price-date"><Clock3 size={13} /> Today's sample price</span></div>
      <div className="option-group"><div className="option-heading"><b>How would you like them?</b><span>Choose your prep</span></div><div className="prep-options"><button type="button" onClick={() => setCleaned(false)} className={`prep-option ${!cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Uncleaned</b><small>As they come, fresh & whole</small></span><strong>Included</strong></button><button type="button" onClick={() => setCleaned(true)} className={`prep-option ${cleaned ? 'selected' : ''}`}><span className="option-radio" /><span><b>Cleaned</b><small>Deveined & ready to cook</small></span><strong>+{money(product.cleaningFee)}</strong></button></div></div>
      <div className="option-group"><div className="option-heading"><b>Pick your weight</b><span>Price adjusts by weight</span></div><div className="weight-options">{[250, 500, 1000].map((grams) => <button key={grams} type="button" className={`weight-option ${weight === grams ? 'selected' : ''}`} onClick={() => setWeight(grams)}>{grams >= 1000 ? '1 kg' : `${grams} g`}</button>)}</div></div>
      <div className="detail-buy-row"><div className="quantity-picker"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus size={15} /></button><span>{quantity}</span><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)}><Plus size={15} /></button></div><button type="button" className="button button-dark add-to-cart" onClick={handleAdd}><ShoppingBag size={17} /> Add to cart · {money(price)}</button></div>
      <div className="detail-delivery-note"><Truck size={17} /><span><b>Delivery across Hyderabad</b><small>Choose a delivery option at checkout · from ₹{deliveryFee}</small></span></div>
    </div></div><section className="detail-bottom-note"><span>✳</span> Sample product information for Phase 1. Availability and prices are for demonstration only.</section></main>
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

function CheckoutPage({ cart, products, onPlaceOrder }) {
  const navigate = useNavigate()
  const [deliveryMethod, setDeliveryMethod] = useState('shop')
  const lines = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) })).filter((item) => item.product)
  const subtotal = lines.reduce((sum, item) => sum + getLinePrice(item, item.product), 0)
  const delivery = deliveryMethod === 'shop' ? deliveryFee : 60
  const total = subtotal + (lines.length ? delivery : 0)
  const submit = (event) => {
    event.preventDefault()
    if (!lines.length) return
    const form = new FormData(event.currentTarget)
    const id = `FP-${Math.floor(100000 + Math.random() * 900000)}`
    onPlaceOrder({ id, name: form.get('name'), phone: form.get('phone'), address: form.get('address'), deliveryMethod, status: 'Confirmed', total, createdAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) })
    navigate('/track')
  }
  if (!lines.length) return <main className="page-main empty-checkout"><div className="empty-state"><ShoppingBag size={35} /><h2>Your cart is waiting for prawns</h2><p>Add something fresh before heading to checkout.</p><Link to="/shop" className="button button-dark">Shop prawns <ArrowRight size={16} /></Link></div></main>
  return <main className="page-main"><Link to="/cart" className="back-link"><ArrowLeft size={16} /> Back to cart</Link><div className="eyebrow">ALMOST THE GOOD PART</div><h1 className="page-heading">Checkout</h1><div className="checkout-layout"><form className="checkout-form" onSubmit={submit}><section className="checkout-panel"><div className="form-section-title"><span>01</span><div><h2>Your details</h2><p>We'll use these to coordinate your delivery.</p></div></div><div className="form-grid"><label>Full name<input name="name" autoComplete="name" placeholder="e.g. Ananya Rao" required /></label><label>Mobile number<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" required /></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>02</span><div><h2>Where should we deliver?</h2><p>Your exact location is only used as a demo form entry.</p></div></div><label className="full-label">Delivery address<textarea name="address" autoComplete="street-address" rows="3" placeholder="House / flat, street, area, Hyderabad" required /></label><div className="location-placeholder"><div className="location-pin"><MapPin size={19} /></div><div><b>Choose a delivery location</b><small>Map and live location will be available in a future phase.</small></div><button type="button" className="location-disabled" disabled>Map coming soon</button></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>03</span><div><h2>How should we get it to you?</h2><p>Choose your preferred delivery partner.</p></div></div><div className="delivery-options"><label className={`delivery-choice ${deliveryMethod === 'shop' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'shop'} onChange={() => setDeliveryMethod('shop')} /><span className="delivery-icon"><Truck size={20} /></span><span><b>Our delivery person</b><small>Personal local delivery</small></span><strong>₹40</strong></label><label className={`delivery-choice ${deliveryMethod === 'partner' ? 'selected' : ''}`}><input type="radio" name="delivery" checked={deliveryMethod === 'partner'} onChange={() => setDeliveryMethod('partner')} /><span className="delivery-icon"><PackageCheck size={20} /></span><span><b>Delivery partner</b><small>Third-party service · sample</small></span><strong>₹60</strong></label></div></section>
      <section className="checkout-panel"><div className="form-section-title"><span>04</span><div><h2>Payment</h2><p>Payment collection isn't enabled for this demo.</p></div></div><div className="payment-placeholder"><Banknote size={19} /><span><b>Pay at delivery</b><small>Placeholder only — no payment is processed.</small></span><span className="demo-tag">DEMO</span></div></section>
      <button type="submit" className="button button-dark full-button place-order">Place demo order · {money(total)} <ArrowRight size={17} /></button><p className="checkout-legal">This creates a local demonstration order only. No real order or delivery is placed.</p></form>
    <aside className="order-summary checkout-summary"><h2>Your order</h2>{lines.map((item) => <div className="summary-product" key={item.key}><img src={item.product.image} alt="" /><span><b>{item.product.name}</b><small>{item.cleaned ? 'Cleaned' : 'Uncleaned'} · {item.weight >= 1000 ? '1 kg' : `${item.weight} g`} × {item.quantity}</small></span><strong>{money(getLinePrice(item, item.product))}</strong></div>)}<div className="summary-row"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Delivery</span><b>{money(delivery)}</b></div><div className="summary-total"><span>Total</span><strong>{money(total)}</strong></div><div className="checkout-summary-note"><BadgeCheck size={15} /> Sample pricing, no payment collected</div></aside></div></main>
}

function TrackPage({ order }) {
  const [lookup, setLookup] = useState('')
  const [searched, setSearched] = useState(false)
  const shownOrder = order || (searched && lookup.trim() ? { id: lookup.trim(), name: 'Sample customer', address: 'Hyderabad', deliveryMethod: 'shop', status: 'In transit', total: 740, createdAt: 'Sample order' } : null)
  const steps = ['Confirmed', 'Preparing', 'Out for delivery', 'Delivered']
  return <main className="page-main tracking-page"><div className="eyebrow">A LITTLE PEACE OF MIND</div><h1 className="page-heading">Track your order</h1><p className="tracking-intro">We'll keep you in the loop, from our counter to your door.</p>
    <form className="tracking-search" onSubmit={(event) => { event.preventDefault(); setSearched(true) }}><label htmlFor="order-lookup">Order number</label><div><input id="order-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="e.g. FP-123456" /><button className="button button-dark" type="submit">Find order <ArrowRight size={16} /></button></div><small>Have a demo order? Your latest order appears below.</small></form>
    {shownOrder ? <section className="tracking-card"><div className="tracking-card-head"><div><span className="status-pill"><i /> {shownOrder.status}</span><h2>Order {shownOrder.id}</h2><p>Placed {shownOrder.createdAt}</p></div><strong>{money(shownOrder.total)}</strong></div><div className="tracking-steps">{steps.map((step, index) => <div className={`tracking-step ${index === 0 ? 'completed' : ''}`} key={step}><span className="tracking-step-icon">{index === 0 ? <Check size={15} /> : index === 1 ? <Fish size={15} /> : index === 2 ? <Truck size={15} /> : <PackageCheck size={15} />}</span><b>{step}</b>{index < steps.length - 1 && <span className="tracking-step-line" />}</div>)}</div><div className="tracking-order-meta"><div><MapPin size={16} /><span><b>Delivering to</b><small>{shownOrder.address || 'Hyderabad'}</small></span></div><div><Truck size={16} /><span><b>Delivery by</b><small>{shownOrder.deliveryMethod === 'partner' ? 'Delivery partner' : 'Our delivery person'}</small></span></div></div><p className="tracking-demo">Frontend demo status. Live order updates will be connected in a future phase.</p></section> : <div className="tracking-empty"><div className="tracking-empty-icon"><PackageCheck size={29} /></div><h2>No order to show just yet</h2><p>Place a demo order at checkout, or enter a sample order number above.</p><Link to="/shop" className="text-link">Browse fresh prawns <ArrowRight size={16} /></Link></div>}
    <div className="tracking-support"><Headset size={18} /><span>Need a hand? <a href="tel:+914040001234">Call our shop at +91 40 4000 1234</a></span></div>
  </main>
}

function SupportSection() {
  return <section id="contact" className="support-section"><div className="support-icon"><Headset size={24} /></div><div><div className="eyebrow">WE'RE RIGHT HERE</div><h2>Questions? Let's talk.</h2><p>Our little shop is always happy to help with your order.</p></div><div className="support-actions"><a className="button button-dark" href="tel:+914040001234">Call the shop <ArrowRight size={16} /></a><span>+91 40 4000 1234 · Hyderabad</span></div></section>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><Link to="/" className="brand footer-brand"><span className="brand-mark"><Fish size={21} /></span><span className="brand-name">fresh<span>prawns</span><small>ONLINE · HYDERABAD</small></span></Link><p>Good prawns, good food, good mood.<br />A neighbourhood shop, with a little more convenience.</p><div className="footer-links"><Link to="/shop">Shop</Link><Link to="/track">Track order</Link><Link to="/admin">Admin demo</Link></div></div><div className="footer-bottom"><span>© 2026 Fresh Prawns Online · Sample storefront for Phase 1</span><span>Made with care in Hyderabad <span className="footer-heart">♥</span></span></div></footer>
}

function AdminPage({ products, updateProduct }) {
  const [tab, setTab] = useState('overview')
  const [selectedOrder, setSelectedOrder] = useState(sampleOrders[0])
  const [orders, setOrders] = useState(sampleOrders)
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'products', label: 'Products' }, { id: 'orders', label: 'Orders' }]
  return <main className="admin-page"><aside className="admin-sidebar"><Link to="/" className="admin-brand"><span className="brand-mark"><Fish size={21} /></span><span>Fresh Prawns<small>SHOP ADMIN · DEMO</small></span></Link><div className="admin-side-label">WORKSPACE</div><nav aria-label="Admin navigation">{tabs.map((item) => <button className={tab === item.id ? 'admin-nav-item active' : 'admin-nav-item'} key={item.id} onClick={() => setTab(item.id)} type="button">{item.id === 'overview' ? <SlidersHorizontal size={17} /> : item.id === 'products' ? <Fish size={17} /> : <PackageCheck size={17} />}{item.label}{item.id === 'orders' && <span className="nav-count">{orders.length}</span>}</button>)}</nav><div className="admin-sidebar-bottom"><span className="admin-avatar">S</span><span><b>Shop owner</b><small>Hyderabad · Demo mode</small></span></div></aside><div className="admin-content"><div className="admin-topbar"><div className="admin-breadcrumb">Workspace <span>/</span> <b>{tabs.find((item) => item.id === tab)?.label}</b></div><Link to="/" className="view-store-link"><ArrowLeft size={14} /> View storefront</Link></div><div className="admin-main-content">{tab === 'overview' && <AdminOverview products={products} orders={orders} setTab={setTab} />}{tab === 'products' && <AdminProducts products={products} updateProduct={updateProduct} />}{tab === 'orders' && <AdminOrders orders={orders} setOrders={setOrders} selectedOrder={selectedOrder} setSelectedOrder={setSelectedOrder} />}</div></div></main>
}

function AdminOverview({ products, orders, setTab }) {
  const revenue = orders.reduce((sum, order) => sum + order.total, 0)
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <div className="eyebrow">TODAY · HYDERABAD</div>
          <h1>Good morning, shop owner <span>✳</span></h1>
          <p>Here’s the shape of your shop today. These are sample numbers.</p>
        </div>
        <span className="demo-badge"><span /> DEMO DATA</span>
      </div>
      <div className="metric-grid">
        <Metric label="Today's sales" value={money(revenue)} change="from sample orders" icon={<Banknote />} />
        <Metric label="Orders today" value={orders.length} change="2 need attention" icon={<PackageCheck />} />
        <Metric label="Active products" value={products.filter((product) => product.active).length} change={`${products.length} in catalogue`} icon={<Fish />} />
        <Metric label="Avg. order value" value={money(orders.length ? revenue / orders.length : 0)} change="sample average" icon={<ArrowDownRight />} />
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
        <div className="stock-glance-grid">{products.slice(0, 3).map((product) => <div className="stock-glance-item" key={product.id}><span>{product.name}</span><b>{product.stockKg.toFixed(1)} kg</b><div className="stock-meter"><i style={{ width: `${Math.min(product.stockKg / 20 * 100, 100)}%` }} /></div></div>)}</div>
      </div>
    </>
  )
}

function Metric({ label, value, change, icon }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong><span className="metric-change">{change}</span></div>
}

function AdminProducts({ products, updateProduct }) {
  return <><div className="admin-page-heading"><div><div className="eyebrow">YOUR CATCH, YOUR CALL</div><h1>Products & daily pricing</h1><p>Manage your catalogue, today's price and stock by weight.</p></div><button className="button button-dark admin-add-product" type="button" onClick={() => window.alert('Adding new products will be available with backend integration in Phase 2.')}><Plus size={16} /> Add product</button></div><div className="admin-card products-table-card"><div className="admin-table-top"><div><h2>Product catalogue</h2><p>Prices shown are illustrative Phase 1 sample values.</p></div><span className="catalogue-count">{products.length} products</span></div><div className="table-scroll"><table className="admin-table"><thead><tr><th>PRODUCT</th><th>PRICE / KG</th><th>STOCK BY WEIGHT</th><th>AVAILABILITY</th><th>LIVE</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="table-product"><img src={product.image} alt="" /><span><b>{product.name}</b><small>{product.size} · {product.origin}</small></span></div></td><td><label className="price-input"><span>₹</span><input aria-label={`${product.name} price per kilogram`} type="number" min="1" step="10" value={product.pricePerKg} onChange={(event) => updateProduct(product.id, { pricePerKg: Number(event.target.value) })} /></label></td><td><div className="stock-adjuster"><button type="button" aria-label={`Reduce ${product.name} stock`} onClick={() => updateProduct(product.id, { stockKg: Math.max(0, +(product.stockKg - 0.5).toFixed(1)) })}><Minus size={13} /></button><b>{product.stockKg.toFixed(1)} kg</b><button type="button" aria-label={`Add ${product.name} stock`} onClick={() => updateProduct(product.id, { stockKg: +(product.stockKg + 0.5).toFixed(1) })}><Plus size={13} /></button></div></td><td><span className={product.stockKg < 3 ? 'stock-status low' : 'stock-status'}><i />{product.stockKg < 3 ? 'Low stock' : 'In stock'}</span></td><td><button className={`toggle ${product.active ? 'on' : ''}`} type="button" role="switch" aria-checked={product.active} aria-label={`${product.active ? 'Deactivate' : 'Activate'} ${product.name}`} onClick={() => updateProduct(product.id, { active: !product.active })}><i /></button></td></tr>)}</tbody></table></div><div className="admin-table-footer"><Sparkles size={15} /> Changes update this local demo only. A server will be needed to save them.</div></div><div className="admin-info-note"><BadgeCheck size={17} /><span><b>Daily pricing is in your hands.</b> Update the per-kilogram price any time to reflect your catch of the day.</span></div></>
}

function AdminOrders({ orders, setOrders, selectedOrder, setSelectedOrder }) {
  const current = orders.find((order) => order.id === selectedOrder?.id) || orders[0]
  const updateOrder = (id, patch) => setOrders((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  return <><div className="admin-page-heading"><div><div className="eyebrow">THE GOOD STUFF IS MOVING</div><h1>Orders</h1><p>Review orders, choose a delivery method and assign a rider.</p></div><span className="demo-badge"><span /> {orders.length} SAMPLE ORDERS</span></div><div className="orders-layout"><section className="admin-card orders-list-card"><div className="admin-card-heading"><div><h2>All orders</h2><p>Tap an order to view details</p></div><button className="admin-filter-button" type="button"><SlidersHorizontal size={15} /> All</button></div><div className="order-list">{orders.map((order) => <button key={order.id} onClick={() => setSelectedOrder(order)} className={`order-list-item ${current?.id === order.id ? 'selected' : ''}`}><span className="order-list-avatar">{order.customer.split(' ').map((word) => word[0]).join('')}</span><span className="order-list-main"><b>{order.customer}</b><small>{order.id} · {order.time}</small></span><span className="order-list-end"><b>{money(order.total)}</b><small className={`admin-status ${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</small></span></button>)}</div></section>{current && <section className="admin-card order-detail-card"><div className="order-detail-heading"><div><span className="eyebrow">ORDER DETAILS</span><h2>{current.id}</h2></div><span className={`admin-status ${current.status.toLowerCase().replaceAll(' ', '-')}`}>{current.status}</span></div><div className="order-detail-customer"><span className="order-list-avatar">{current.customer.split(' ').map((word) => word[0]).join('')}</span><span><b>{current.customer}</b><small>{current.phone}</small></span><button type="button" className="admin-text-button" onClick={() => window.alert(`Demo contact: ${current.phone}`)}>Contact</button></div><div className="order-detail-address"><MapPin size={16} /><span><b>Delivery address</b><small>{current.address}</small></span></div><div className="detail-products"><b>Items</b>{current.items.map((item) => <div key={item.name}><span>{item.name}<small>{item.detail}</small></span><strong>{money(item.price)}</strong></div>)}</div><div className="admin-delivery-config"><label>Delivery method<select value={current.deliveryMethod} onChange={(event) => updateOrder(current.id, { deliveryMethod: event.target.value })}><option value="shop">Our delivery person</option><option value="partner">Third-party partner</option></select></label><label>Assign delivery person<input value={current.assignee || ''} onChange={(event) => updateOrder(current.id, { assignee: event.target.value })} placeholder="e.g. Ramesh (demo)" /></label></div><div className="order-detail-total"><span>Order total</span><b>{money(current.total)}</b></div><label className="status-control">Order status<select value={current.status} onChange={(event) => updateOrder(current.id, { status: event.target.value })}><option>New</option><option>Confirmed</option><option>Preparing</option><option>Out for delivery</option><option>Delivered</option></select></label><p className="admin-demo-hint">All updates stay in this browser session. No real order or delivery service is connected.</p></section>}</div></>
}

function NotFound() {
  return <main className="page-main not-found"><div className="empty-state"><Fish size={38} /><div className="eyebrow">OOPS, WRONG AISLE</div><h2>We couldn't find that page</h2><p>Let's get you back to the good stuff.</p><Link to="/" className="button button-dark">Back to home <ArrowRight size={16} /></Link></div></main>
}

export default App
