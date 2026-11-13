# Demos

Three live doors. Each one shows a different job: a stay, a purchase, and a company site. The [directory](/directory) lists every site that passes the check. These three are a place to start.

CAP does not require Cosmic, or any other vendor.

<div class="paths">
<a href="#marlow"><span>Stay</span><strong>Marlow</strong><p>A public catalog of homes, then a guest login for one person's stay.</p></a>
<a href="#swsh"><span>Purchase</span><strong>SWSH</strong><p>A server-side bag, a confirm step, and payment on the site.</p></a>
<a href="#cosmic"><span>Company</span><strong>Cosmic</strong><p>Answers from the product and the docs, on the company's own site.</p></a>
</div>

## Marlow

<figure class="demo-shot"><a href="https://marlow.cosmic.site/"><img src="/demos/marlow.jpg" width="1280" height="575" alt="The Marlow homepage: homes in Sonoma County, with Orchard House, Cinder Cabin, and Bodega Bluff"></a></figure>

[Marlow](https://marlow.cosmic.site/) is a vacation-rental site. A public question is answered from the catalog. A question about one guest's stay waits for that guest to log in. Bookings are simulated.

Ask on the site, or send the same question through the door:

- What stays are available?
- Four people, Sonoma, three nights: two bedrooms, a hot tub, under $1,200.
- Sign in as `maya` / `maya`, then ask: What are my arrival instructions?

A change, such as extending the stay or cancelling, waits for the guest to approve it.

[Open the site](https://marlow.cosmic.site/) · [Check this door](https://conciergeprotocol.org/check?domain=marlow.cosmic.site) · [Source](https://github.com/cosmic-community/marlow)

## SWSH

<figure class="demo-shot"><a href="https://swsh.cosmic.site/products"><img src="/demos/swsh.jpg" width="1280" height="700" alt="The SWSH product list: socks, a runner, a court shoe, and a low-stock sneaker"></a></figure>

[SWSH](https://swsh.cosmic.site/) is a store. The bag is stored on the server, so the shopper's browser and their agent change the same bag. Checkout does not charge by itself. The door returns a confirmation, the shopper pays on the site through Stripe, and the agent reads the order number when payment finishes.

- What shoes do you have?
- Sign in and allow changes, then ask: Add the Pegasus 41 in size 10 to my bag.
- Check out.

[Open the site](https://swsh.cosmic.site/) · [Check this door](https://conciergeprotocol.org/check?domain=swsh.cosmic.site) · [Source](https://github.com/cosmic-community/nike-clone-9c2g)

## Cosmic

<figure class="demo-shot"><a href="https://www.cosmicjs.com/"><img src="/demos/cosmic.jpg" width="1280" height="800" alt="The Cosmic homepage, with the chat open over a dashboard of blog posts"></a></figure>

[Cosmic](https://www.cosmicjs.com/) is the company site. Ask about the product, the docs, or a plan. A question about an account asks you to log in.

- What is a bucket?
- How do I add a CAP door to a site?

[Open the site](https://www.cosmicjs.com/) · [Check this door](https://conciergeprotocol.org/check?domain=www.cosmicjs.com)

## Run a door yourself

The [store example](examples/store) is the same path on your machine: a public product question, a login, and an order. The [Next.js example](examples/next) is the door as a route in an app.
