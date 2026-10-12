const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const OFF_BASE = "https://world.openfoodfacts.net";

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

// Official registry links. These are manual checks, not API results.
const certificationBodies = [
  {
    name: "BPJPH",
    country: "Indonesia",
    website: "https://bpjph.halal.go.id/",
    searchUrl: "https://bpjph.halal.go.id/cari/sertifikat",
    method: "OFFICIAL MANUAL SEARCH",
    note: "Search by product name, business name or certificate number."
  },
  {
    name: "MUIS",
    country: "Singapore",
    website: "https://www.muis.gov.sg/halal/",
    searchUrl: "https://halal.muis.gov.sg/halal/products",
    method: "OFFICIAL MANUAL SEARCH",
    note: "Search the MUIS certified-products directory."
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

app.get("/api/certification-bodies", (req, res) => {
  res.json({
    note:
      "Official registry links are provided for manual checks. Listing a certification body does not verify a product certificate or recognition in another country.",
    bodies: certificationBodies
  });
});

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
        "No ingredient list is available in this product record. Check the packaging or manufacturer.",
      flaggedIngredients: []
    };
  }

  const text = ingredients.toLowerCase();

  const potentiallyProhibitedRules = [
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

  const prohibited = findMatches(text, potentiallyProhibitedRules);

  if (prohibited.length) {
    return {
      status: "POTENTIAL PROHIBITED INGREDIENT",
      explanation:
        "The database lists a potentially prohibited ingredient term: " +
        prohibited.join(", ") +
        ". Confirm the actual label and ingredient source before making a decision. This automated match is not a definitive religious ruling.",
      flaggedIngredients: prohibited
    };
  }

  const review = findMatches(text, verificationRules);

  if (review.length) {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "Some ingredients may depend on their source or processing method. Check with the manufacturer or a reliable halal certifier.",
      flaggedIngredients: review
    };
  }

  return {
    status: "NO OBVIOUS CONCERN DETECTED",
    explanation:
      "The automated screen found no terms on its watchlist. This does not prove halal status; the full ingredient information and certification still need checking.",
    flaggedIngredients: []
  };
}

function assessDatabaseLabels(product) {
  const labels = [
    product.labels || "",
    ...(Array.isArray(product.labels_tags)
      ? product.labels_tags
      : [])
  ].join(" ");

  const reportsHalal = /\bhalal\b/i.test(labels);

  if (reportsHalal) {
    return {
      status: "HALAL LABEL REPORTED — NOT VERIFIED",
      evidence:
        "Open Food Facts reports a halal label for this product. This database label has not been independently verified against an official certificate.",
      verified: false
    };
  }

  return {
    status: "NOT VERIFIED",
    evidence:
      "No halal certificate has been independently verified by HalalCheck AI. Missing database information does not prove that the product is uncertified.",
    verified: false
  };
}

function buildOverallAssessment(ingredientScreening) {
  if (
    ingredientScreening.status ===
    "POTENTIAL PROHIBITED INGREDIENT"
  ) {
    return {
      status: "REVIEW REQUIRED",
      explanation:
        "A potentially prohibited ingredient term was found. Verify its source and check applicable certification before deciding."
    };
  }

  if (
    ingredientScreening.status === "INSUFFICIENT INFORMATION"
  ) {
    return {
      status: "CANNOT DETERMINE",
      explanation:
        "Ingredient information is missing and product-specific certification has not been independently verified."
    };
  }

  if (ingredientScreening.status === "NEEDS VERIFICATION") {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "At least one ingredient needs further checking. Halal certification has not been independently verified."
    };
  }

  return {
    status: "NOT CONFIRMED",
    explanation:
      "No obvious concern was detected by the ingredient watchlist, but halal status is not confirmed without reliable product-specific evidence."
  };
}

function makeRegistryChecks(productName, brand) {
  const searchTerm = [brand, productName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const bodies = certificationBodies.map((body) => {
    let searchUrl = body.searchUrl;

    // BPJPH's official portal supports a product-name query.
    if (body.name === "BPJPH" && searchTerm) {
      searchUrl =
        "https://bpjph.halal.go.id/cari/sertifikat?produk=" +
        encodeURIComponent(searchTerm);
    }

    return {
      name: body.name,
      country: body.country,
      website: body.website,
      searchUrl,
      method: body.method,
      status: "MANUAL CHECK REQUIRED",
      note: body.note
    };
  });

  return bodies;
}

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
      url.pathname =
        "/api/v2/product/" +
        encodeURIComponent(query) +
        ".json";

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
      headers: {
        "User-Agent": "HalalCheckAI/1.0"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(
        "Open Food Facts returned HTTP " + response.status
      );
    }

    const data = await response.json();

    const sourceProducts = isBarcode
      ? data.status === 1 && data.product
        ? [data.product]
        : []
      : data.products || [];

    const products = sourceProducts
      .filter((p) => p.product_name && p.code)
      .map((p) => {
        const ingredients =
          p.ingredients_text_en || p.ingredients_text || "";

        const halalScreening = assessIngredients(ingredients);
        const certification = assessDatabaseLabels(p);
        const overallAssessment =
          buildOverallAssessment(halalScreening);

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
          overallAssessment,
          registryChecks: makeRegistryChecks(
            p.product_name,
            p.brands || ""
          ),
          dataLimitations: [
            "Product and ingredient data may be incomplete or outdated.",
            "A database-reported halal label is not independent certificate verification.",
            "Official registry links require the user to check the relevant record.",
            "No worldwide certification API has been connected yet."
          ]
        };
      });

    res.json({
      query,
      mode: isBarcode ? "barcode" : "name",
      count: products.length,
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
  console.log("HalalCheck AI running on port " + PORT);
});
