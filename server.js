const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const OFF_BASE = "https://world.openfoodfacts.net";
const BPJPH_DOMESTIC =
  "https://bpjph.halal.go.id/cari/sertifikat";
const BPJPH_FOREIGN =
  "https://bpjph.halal.go.id/cari/produk-halal-ln";

const PRODUCT_FIELDS = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "countries",
  "ingredients_text",
  "ingredients_text_en",
  "image_front_url",
  "url",
  "labels",
  "labels_tags"
].join(",");

const certificationBodies = [
  {
    name: "BPJPH",
    country: "Indonesia",
    website: "https://bpjph.halal.go.id/",
    searchUrl: BPJPH_DOMESTIC,
    method: "PUBLIC OFFICIAL PAGE LOOKUP",
    note:
      "Automated lookup attempts to read the public search page. This is not a documented official API."
  },
  {
    name: "MUIS",
    country: "Singapore",
    website: "https://www.muis.gov.sg/halal/",
    searchUrl: "https://halal.muis.gov.sg/halal/products",
    method: "OFFICIAL MANUAL SEARCH",
    note: "Search the official certified-products directory."
  },
  {
    name: "JAKIM",
    country: "Malaysia",
    website: "https://www.halal.gov.my/",
    searchUrl: "https://www.halal.gov.my/",
    method: "OFFICIAL WEBSITE",
    note: "Use the official Malaysian halal information services."
  },
  {
    name: "IFANCA",
    country: "United States",
    website: "https://ifanca.org/",
    searchUrl: "https://ifanca.org/",
    method: "OFFICIAL WEBSITE",
    note: "Consult IFANCA for current product certification information."
  },
  {
    name: "Halal Food Authority",
    country: "United Kingdom",
    website: "https://halalfoodauthority.com/",
    searchUrl: "https://halalfoodauthority.com/",
    method: "OFFICIAL WEBSITE",
    note: "Consult the authority for product and certificate information."
  }
];

const lookupCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

app.get("/api/health", (req, res) => {
  res.json({
    service: "HalalCheck AI",
    status: "running",
    bpjphLookup: "provisional public-page parser",
    officialApiConnected: false,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/certification-bodies", (req, res) => {
  res.json({
    note:
      "A directory entry does not verify a product. BPJPH public-page lookup is provisional and is not a documented official API.",
    bodies: certificationBodies
  });
});

function cleanText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:td|th|tr|p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalise(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseTableRows(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cleanText(cellMatch[1]));
    }

    if (cells.length) rows.push(cells);
  }

  return rows;
}

function tokenOverlap(a, b) {
  const left = new Set(normalise(a).split(" ").filter(Boolean));
  const right = new Set(normalise(b).split(" ").filter(Boolean));

  if (!left.size || !right.size) return 0;

  let matches = 0;
  for (const token of left) {
    if (right.has(token)) matches++;
  }

  return matches / left.size;
}

function productNameMatches(query, listedName) {
  const q = normalise(query);
  const p = normalise(listedName);

  if (!q || !p) return false;
  if (q === p) return true;

  // Avoid treating short or generic words as a confirmed match.
  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length < 2) {
    return p.includes(q) && q.length >= 6;
  }

  return p.includes(q) || tokenOverlap(q, p) >= 0.8;
}

function parseDomesticRows(html, query) {
  const rows = parseTableRows(html);
  const matches = [];

  for (const cells of rows) {
    // Expected columns:
    // number, product, producer, certificate, date
    if (cells.length < 5) continue;

    const [number, product, producer, certificate, date] = cells;

    if (
      !product ||
      !certificate ||
      /^(produk|product)$/i.test(product)
    ) {
      continue;
    }

    if (!productNameMatches(query, product)) continue;

    matches.push({
      registry: "BPJPH domestic certificate search",
      product,
      producer,
      certificateNumber: certificate,
      recordDate: date,
      recordStatus: "NOT SHOWN IN SEARCH RESULT",
      currentValidity: "NOT CONFIRMED",
      evidenceUrl: BPJPH_DOMESTIC,
      matchType:
        normalise(query) === normalise(product)
          ? "NORMALISED EXACT PRODUCT NAME"
          : "CLOSE PRODUCT NAME MATCH",
      verified: false
    });
  }

  return matches.slice(0, 5);
}

function parseForeignRows(html, query) {
  const rows = parseTableRows(html);
  const matches = [];

  for (const cells of rows) {
    // Expected columns:
    // number, product, company, factory, importer,
    // registration number, expiry date, halal body, status
    if (cells.length < 9) continue;

    const [
      number,
      product,
      company,
      factory,
      importer,
      registrationNumber,
      expiryDate,
      halalBody,
      status
    ] = cells;

    if (
      !product ||
      /^(produk|product)$/i.test(product) ||
      !productNameMatches(query, product)
    ) {
      continue;
    }

    const expiry = parseDate(expiryDate);
    const now = new Date();
    const statusText = normalise(status);
    const saysInactive =
      /\b(tidak berlaku|tidak aktif|expired|inactive|revoked|cancelled|canceled)\b/.test(
        statusText
      );
    const saysActive =
      /\b(berlaku|aktif|active|valid)\b/.test(statusText) &&
      !saysInactive;

    let validity = "NOT CONFIRMED";

    if (saysInactive) {
      validity = "REGISTRY REPORTS INACTIVE";
    } else if (expiry && expiry < now) {
      validity = "EXPIRY DATE HAS PASSED";
    } else if (saysActive && expiry && expiry >= now) {
      validity = "ACTIVE STATUS AND FUTURE EXPIRY REPORTED";
    }

    matches.push({
      registry: "BPJPH foreign-product registration search",
      product,
      company,
      factory,
      importer,
      registrationNumber,
      expiryDate,
      halalCertificationBody: halalBody,
      recordStatus: status,
      currentValidity: validity,
      evidenceUrl: BPJPH_FOREIGN,
      matchType:
        normalise(query) === normalise(product)
          ? "NORMALISED EXACT PRODUCT NAME"
          : "CLOSE PRODUCT NAME MATCH",
      verified: false
    });
  }

  return matches.slice(0, 5);
}

function parseDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  // Prefer ISO dates; the portal may also display dates
  // such as "12 October 2026".
  let date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date;

  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    date = new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1])
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

async function fetchOfficialSearchPage(baseUrl, query) {
  const url = new URL(baseUrl);
  url.searchParams.set("produk", query);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "HalalCheckAI/1.0 (public registry lookup; contact via website)",
      Accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error("Official page returned HTTP " + response.status);
  }

  const html = await response.text();

  if (!html || html.length < 100) {
    throw new Error("Official page returned no usable HTML");
  }

  return {
    url: url.toString(),
    html,
    fetchedAt: new Date().toISOString()
  };
}

async function lookupBPJPH(productName) {
  const query = cleanText(productName);

  if (!query || query.length < 2) {
    return {
      status: "NOT SEARCHED",
      explanation: "A product name is required.",
      sourceType: "PUBLIC OFFICIAL WEB PAGES",
      officialApiConnected: false,
      checkedAt: null,
      domestic: [],
      foreign: [],
      manualLinks: {
        domestic: BPJPH_DOMESTIC,
        foreign: BPJPH_FOREIGN
      }
    };
  }

  const cacheKey = normalise(query);
  const cached = lookupCache.get(cacheKey);

  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return {
      ...cached.value,
      cache: "CACHED RESULT",
      checkedAt: cached.value.checkedAt
    };
  }

  const checkedAt = new Date().toISOString();

  const results = await Promise.allSettled([
    fetchOfficialSearchPage(BPJPH_DOMESTIC, query),
    fetchOfficialSearchPage(BPJPH_FOREIGN, query)
  ]);

  const domesticPage =
    results[0].status === "fulfilled" ? results[0].value : null;
  const foreignPage =
    results[1].status === "fulfilled" ? results[1].value : null;

  const domestic = domesticPage
    ? parseDomesticRows(domesticPage.html, query)
    : [];

  const foreign = foreignPage
    ? parseForeignRows(foreignPage.html, query)
    : [];

  const failures = [];
  if (!domesticPage) {
    failures.push("Domestic registry page could not be read.");
  }
  if (!foreignPage) {
    failures.push("Foreign-product registry page could not be read.");
  }

  let status;
  let explanation;

  if (domestic.length || foreign.length) {
    status = "POSSIBLE OFFICIAL REGISTRY MATCH";
    explanation =
      "A product-name match was found on a BPJPH public search page. " +
      "The provisional parser is not an official API, and the match " +
      "must be checked against the linked official record. " +
      "Do not treat this result alone as final halal confirmation.";
  } else if (failures.length === 2) {
    status = "AUTOMATIC LOOKUP UNAVAILABLE";
    explanation =
      "The official search pages could not be read automatically. " +
      "This is not evidence that the product is uncertified.";
  } else {
    status = "NO MATCH FOUND IN SEARCHED RESULTS";
    explanation =
      "No sufficiently close product-name match was found in the " +
      "records returned by the public pages. This does not prove " +
      "that the product lacks halal certification.";
  }

  const value = {
    status,
    explanation,
    sourceType: "PROVISIONAL PUBLIC-WEB-PAGE PARSER",
    officialApiConnected: false,
    checkedAt,
    domestic,
    foreign,
    failures,
    manualLinks: {
      domestic:
        domesticPage?.url ||
        new URL(BPJPH_DOMESTIC).toString(),
      foreign:
        foreignPage?.url ||
        new URL(BPJPH_FOREIGN).toString()
    }
  };

  lookupCache.set(cacheKey, { time: Date.now(), value });
  return value;
}

function findMatches(text, rules) {
  return rules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.name);
}

function assessIngredients(ingredients) {
  if (!ingredients || !ingredients.trim()) {
    return {
      status: "INSUFFICIENT INFORMATION",
      explanation:
        "No ingredient list is available. Check the package or manufacturer.",
      flaggedIngredients: []
    };
  }

  const text = ingredients.toLowerCase();

  const prohibitedRules = [
    { pattern: /\bpork\b/i, name: "Pork" },
    { pattern: /\bporcine\b/i, name: "Porcine-derived ingredient" },
    { pattern: /\blard\b/i, name: "Lard" },
    { pattern: /\bbacon\b/i, name: "Bacon" },
    { pattern: /\bham\b/i, name: "Ham" }
  ];

  const verificationRules = [
    { pattern: /\bgelatin\b/i, name: "Gelatin" },
    { pattern: /\bgelatine\b/i, name: "Gelatine" },
    { pattern: /\benzymes?\b/i, name: "Enzymes" },
    { pattern: /\bglycerin\b/i, name: "Glycerin" },
    { pattern: /\bglycerol\b/i, name: "Glycerol" },
    { pattern: /\be471\b/i, name: "E471" },
    { pattern: /\be472[a-d]?\b/i, name: "E472" },
    { pattern: /\brennet\b/i, name: "Rennet" },
    {
      pattern: /\bmono-? and diglycerides\b/i,
      name: "Mono- and diglycerides"
    },
    { pattern: /\bnatural flavours?\b/i, name: "Natural flavouring" },
    { pattern: /\bnatural flavors?\b/i, name: "Natural flavoring" },
    { pattern: /\bshortening\b/i, name: "Shortening" },
    { pattern: /\bwine\b/i, name: "Wine" },
    { pattern: /\brum\b/i, name: "Rum" },
    { pattern: /\bbrandy\b/i, name: "Brandy" },
    { pattern: /\bbeer\b/i, name: "Beer" }
  ];

  const prohibited = findMatches(text, prohibitedRules);

  if (prohibited.length) {
    return {
      status: "POTENTIAL PROHIBITED INGREDIENT",
      explanation:
        "Potentially concerning ingredient terms were found: " +
        prohibited.join(", ") +
        ". Confirm the ingredient source and the actual package. " +
        "This keyword match is not a definitive religious ruling.",
      flaggedIngredients: prohibited
    };
  }

  const review = findMatches(text, verificationRules);

  if (review.length) {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "Some ingredients may depend on their source or processing method.",
      flaggedIngredients: review
    };
  }

  return {
    status: "NO OBVIOUS CONCERN DETECTED",
    explanation:
      "No watchlist terms were detected. This does not prove halal status.",
    flaggedIngredients: []
  };
}

function assessDatabaseLabels(product) {
  const labels = [
    product.labels || "",
    ...(Array.isArray(product.labels_tags) ? product.labels_tags : [])
  ].join(" ");

  if (/\bhalal\b/i.test(labels)) {
    return {
      status: "HALAL LABEL REPORTED — NOT VERIFIED",
      evidence:
        "Open Food Facts reports a halal label, but it has not been independently verified.",
      verified: false
    };
  }

  return {
    status: "NOT VERIFIED",
    evidence:
      "No product-specific halal certificate has been independently verified.",
    verified: false
  };
}

function buildOverallAssessment(ingredients, bpjph) {
  if (ingredients.status === "POTENTIAL PROHIBITED INGREDIENT") {
    return {
      status: "REVIEW REQUIRED",
      explanation:
        "A potentially concerning ingredient was detected. Verify its source even if a registry record is found."
    };
  }

  const activeForeignRecord = (bpjph.foreign || []).some(
    (record) =>
      record.currentValidity ===
      "ACTIVE STATUS AND FUTURE EXPIRY REPORTED"
  );

  if (activeForeignRecord) {
    return {
      status: "BPJPH FOREIGN REGISTRY MATCH — ACTIVE STATUS REPORTED",
      explanation:
        "The public foreign-product registry reports a matching record with an active status and future expiry date. Verify the official record and ensure the package matches before relying on it."
    };
  }

  if ((bpjph.domestic || []).length) {
    return {
      status: "BPJPH CERTIFICATE RECORD FOUND — STATUS NOT CONFIRMED",
      explanation:
        "A possible domestic certificate record was found, but current validity has not been established by this search."
    };
  }

  if ((bpjph.foreign || []).length) {
    return {
      status: "BPJPH FOREIGN REGISTRY MATCH — REVIEW DETAILS",
      explanation:
        "A possible foreign-product record was found. The current status or expiry could not be established confidently."
    };
  }

  if (ingredients.status === "INSUFFICIENT INFORMATION") {
    return {
      status: "CANNOT DETERMINE",
      explanation:
        "Ingredient information is missing and no BPJPH match was found in the returned search results."
    };
  }

  if (ingredients.status === "NEEDS VERIFICATION") {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "At least one ingredient needs checking. No matching BPJPH record was found in the returned results."
    };
  }

  return {
    status: "NOT CONFIRMED",
    explanation:
      "No sufficiently close BPJPH match was found. This does not mean the product is uncertified; check other official registries."
  };
}

function makeRegistryChecks(productName, brand) {
  const searchTerm = [brand, productName].filter(Boolean).join(" ").trim();

  return certificationBodies.map((body) => {
    const searchUrl = body.name === "BPJPH"
      ? `${BPJPH_DOMESTIC}?produk=${encodeURIComponent(productName)}`
      : body.searchUrl;

    return {
      name: body.name,
      country: body.country,
      website: body.website,
      searchUrl,
      method: body.method,
      status: "MANUAL CHECK AVAILABLE",
      note: body.note,
      searchTerm
    };
  });
}

// Dedicated endpoint for testing the BPJPH lookup independently.
app.get("/api/verification/bpjph", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({
      error: "Enter a product name between 2 and 100 characters."
    });
  }

  try {
    const result = await lookupBPJPH(query);
    res.json({ query, result });
  } catch (error) {
    console.error("BPJPH lookup failed:", error.message);
    res.status(502).json({
      error: "BPJPH lookup failed. Use the official links to check manually."
    });
  }
});

app.get("/api/products", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const mode = String(req.query.mode || "auto");

  const isBarcode =
    mode === "barcode"
      ? true
      : mode === "name"
      ? false
      : /^\d{8,14}$/.test(query);

  if (
    query.length < 2 ||
    query.length > 100 ||
    (isBarcode && !/^\d{8,14}$/.test(query))
  ) {
    return res.status(400).json({
      error: isBarcode
        ? "Enter a barcode containing 8 to 14 digits."
        : "Enter a product name between 2 and 100 characters."
    });
  }

  try {
    const url = new URL(OFF_BASE);

    if (isBarcode) {
      url.pathname = `/api/v2/product/${encodeURIComponent(query)}.json`;
      url.searchParams.set("fields", PRODUCT_FIELDS);
    } else {
      url.pathname = "/cgi/search.pl";
      url.searchParams.set("search_terms", query);
      url.searchParams.set("sort_by", "unique_scans_n");
      url.searchParams.set("search_simple", "1");
      url.searchParams.set("action", "process");
      url.searchParams.set("json", "1");
      url.searchParams.set("page_size", "10");
      url.searchParams.set("fields", PRODUCT_FIELDS);
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "HalalCheckAI/1.0" },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Open Food Facts returned HTTP ${response.status}`);
    }

    const data = await response.json();

    const sourceProducts = isBarcode
      ? data.status === 1 && data.product
        ? [data.product]
        : []
      : data.products || [];

    // Only run registry lookups for name searches, not for numeric barcodes.
    const bpjph = isBarcode
      ? null
      : await lookupBPJPH(query).catch((error) => ({
          status: "AUTOMATIC LOOKUP UNAVAILABLE",
          explanation: error.message,
          sourceType: "PROVISIONAL PUBLIC-WEB-PAGE PARSER",
          officialApiConnected: false,
          checkedAt: new Date().toISOString(),
          domestic: [],
          foreign: [],
          failures: ["Lookup failed."],
          manualLinks: {
            domestic: BPJPH_DOMESTIC,
            foreign: BPJPH_FOREIGN
          }
        }));

    const products = sourceProducts
      .filter((p) => p.product_name && p.code)
      .map((p) => {
        const ingredients =
          p.ingredients_text_en || p.ingredients_text || "";

        const halalScreening = assessIngredients(ingredients);
        const certification = assessDatabaseLabels(p);

        // The registry search uses the user's query. For barcode searches,
        // do not claim the query itself was checked against BPJPH.
        const productBPJPH = bpjph || {
          status: "NOT SEARCHED",
          explanation:
            "BPJPH lookup was not run for this barcode search. Search by product name to attempt it.",
          sourceType: "NOT RUN",
          officialApiConnected: false,
          checkedAt: null,
          domestic: [],
          foreign: [],
          manualLinks: {
            domestic:
              `${BPJPH_DOMESTIC}?produk=${encodeURIComponent(p.product_name)}`,
            foreign:
              `${BPJPH_FOREIGN}?produk=${encodeURIComponent(p.product_name)}`
          }
        };

        return {
          barcode: p.code,
          name: p.product_name,
          brand: p.brands || "",
          quantity: p.quantity || "",
          countries: p.countries || "",
          ingredients,
          image: p.image_front_url || "",
          sourceUrl: p.url || "",
          halalScreening,
          certification,
          bpjphVerification: productBPJPH,
          overallAssessment: buildOverallAssessment(
            halalScreening,
            productBPJPH
          ),
          registryChecks: makeRegistryChecks(
            p.product_name,
            p.brands || ""
          ),
          dataLimitations: [
            "Open Food Facts is a community-contributed product database.",
            "BPJPH lookup reads public web pages and is not an official API integration.",
            "A product-name match may refer to a different size, variant, producer or market.",
            "A search result does not independently establish current certificate validity.",
            "No worldwide certification API has been connected."
          ]
        };
      });

    res.json({
      query,
      mode: isBarcode ? "barcode" : "name",
      count: products.length,
      bpjphLookup: bpjph
        ? {
            status: bpjph.status,
            sourceType: bpjph.sourceType,
            officialApiConnected: bpjph.officialApiConnected,
            checkedAt: bpjph.checkedAt
          }
        : null,
      products
    });
  } catch (error) {
    console.error("Product lookup failed:", error.message);

    res.status(502).json({
      error:
        "Product information is temporarily unavailable. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HalalCheck AI running on port ${PORT}`);
});
