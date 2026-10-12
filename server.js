const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

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
  "labels_tags",
  "ingredients_analysis_tags"
].join(",");

// This is an informational directory, not a product certificate registry.
const certificationBodies = [
  {
    name: "JAKIM",
    country: "Malaysia",
    website: "https://www.halal.gov.my/",
    recognitionStatus: "NOT YET VERIFIED",
    evidenceSource: "https://www.halal.gov.my/"
  },
  {
    name: "BPJPH",
    country: "Indonesia",
    website: "https://halal.go.id/",
    recognitionStatus: "NOT YET VERIFIED",
    evidenceSource: "https://halal.go.id/"
  },
  {
    name: "MUIS",
    country: "Singapore",
    website: "https://www.muis.gov.sg/",
    recognitionStatus: "NOT YET VERIFIED",
    evidenceSource: "https://www.muis.gov.sg/"
  },
  {
    name: "IFANCA",
    country: "United States",
    website: "https://ifanca.org/",
    recognitionStatus: "NOT YET VERIFIED",
    evidenceSource: "https://ifanca.org/"
  },
  {
    name: "Halal Food Authority",
    country: "United Kingdom",
    website: "https://halalfoodauthority.com/",
    recognitionStatus: "NOT YET VERIFIED",
    evidenceSource: "https://halalfoodauthority.com/"
  }
];

app.get("/api/certification-bodies", (req, res) => {
  res.json({
    note:
      "This directory lists certification organisations. It does not verify product-specific certificates or guarantee recognition in every country.",
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
        "The ingredient list is missing from the product database. A reliable assessment cannot be made from the available information.",
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

  const prohibitedMatches = findMatches(
    text,
    potentiallyProhibitedRules
  );

  if (prohibitedMatches.length > 0) {
    return {
      status: "POTENTIAL PROHIBITED INGREDIENT",
      explanation:
        "The database lists a potentially prohibited ingredient term: " +
        prohibitedMatches.join(", ") +
        ". Check the actual packaging and ingredient source. This automated match is not a definitive religious ruling.",
      flaggedIngredients: prohibitedMatches
    };
  }

  const verificationMatches = findMatches(text, verificationRules);

  if (verificationMatches.length > 0) {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "One or more ingredients may depend on their source or processing method. Their presence alone does not establish that the product is haram. Check with the manufacturer or a reliable halal certification source.",
      flaggedIngredients: verificationMatches
    };
  }

  return {
    status: "NO OBVIOUS CONCERN DETECTED",
    explanation:
      "The automated screen found no terms on its watchlist. This is not proof of halal status; the complete ingredients and product-specific certification still need verification.",
    flaggedIngredients: []
  };
}

// Open Food Facts may report a halal label, but that alone does not
// establish that a valid certificate has been independently checked.
function assessCertification(product) {
  const labels = Array.isArray(product.labels_tags)
    ? product.labels_tags
    : [];

  const labelText = [
    product.labels || "",
    ...labels
  ].join(" ").toLowerCase();

  const hasHalalLabel =
    /\bhalal\b/i.test(labelText) ||
    labels.some((label) =>
      /(^|:)halal($|:|-)/i.test(String(label))
    );

  if (hasHalalLabel) {
    return {
      status: "HALAL LABEL REPORTED — NOT VERIFIED",
      evidence:
        'The Open Food Facts product record reports a halal label. This is a database claim, not independent confirmation of a valid certificate. Check the packaging and the certifier’s official records.',
      source: product.url || "Open Food Facts",
      verified: false
    };
  }

  return {
    status: "NO VERIFIED CERTIFICATE FOUND",
    evidence:
      "No product-specific halal certificate has been verified by this app. The database may have incomplete label information, so this does not prove that the product is uncertified.",
    source: product.url || "Open Food Facts",
    verified: false
  };
}

function buildAssessment(ingredients, certification) {
  const screening = assessIngredients(ingredients);

  // A database label is not enough to issue a verified halal verdict.
  // A clear ingredient concern also cannot be dismissed merely because
  // a database reports a halal label.
  if (
    screening.status === "POTENTIAL PROHIBITED INGREDIENT"
  ) {
    return {
      status: "REVIEW REQUIRED",
      explanation:
        "A potentially prohibited ingredient term was detected. Check the actual ingredient source and any applicable certification before deciding."
    };
  }

  if (screening.status === "INSUFFICIENT INFORMATION") {
    return {
      status: "CANNOT DETERMINE",
      explanation:
        "The ingredient list is missing. A product-specific halal certificate has not been independently verified."
    };
  }

  if (screening.status === "NEEDS VERIFICATION") {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "Some ingredients require source or processing checks. A database-reported halal label, if present, has not been independently verified."
    };
  }

  return {
    status: "NOT CONFIRMED",
    explanation:
      "No obvious concern was detected by the ingredient watchlist, but this app has not independently verified a valid halal certificate for this exact product."
  };
}

app.get("/api/products", async (req, res) => {
  const query = String(req.query.q || "").trim();

  console.log(
    "Product search query:",
    query,
    "| Mode:",
    req.query.mode
  );

  const isBarcode =
    req.query.mode === "barcode"
      ? true
      : req.query.mode === "name"
      ? false
      : /^\d{8,14}$/.test(query);

  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({
      error:
        "Enter a product name or barcode between 2 and 100 characters."
    });
  }

  try {
    const url = new URL("https://world.openfoodfacts.net");

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

    console.log("API request URL:", url.toString());

    const response = await fetch(url, {
      headers: {
        "User-Agent": "HalalCheckAI/0.3"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(
        `Product database returned HTTP ${response.status}`
      );
    }

    const data = await response.json();

    let sourceProducts;

    if (isBarcode) {
      sourceProducts =
        data.status === 1 && data.product
          ? [data.product]
          : [];
    } else {
      sourceProducts = data.products || [];
    }

    const products = sourceProducts
      .filter((product) => product.product_name && product.code)
      .map((product) => {
        const ingredients =
          product.ingredients_text_en ||
          product.ingredients_text ||
          "";

        const halalScreening = assessIngredients(ingredients);
        const certification = assessCertification(product);
        const overallAssessment = buildAssessment(
          ingredients,
          certification
        );

        return {
          barcode: product.code,
          name: product.product_name,
          brand: product.brands || "",
          quantity: product.quantity || "",
          countries: product.countries || "",
          ingredients,
          image: product.image_front_url || "",
          sourceUrl: product.url || "",

          halalScreening,
          certification,
          overallAssessment,

          dataLimitations: [
            "Ingredient information comes from a public product database and may be incomplete or outdated.",
            "A halal label reported by the database is not independent certificate verification.",
            "This app has not yet connected to official product-specific certification registries."
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
    console.error("PRODUCT API ERROR:", error);

    res.status(502).json({
      error:
        "Could not retrieve products right now. Please try again shortly."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `HalalCheck AI is running at http://localhost:${PORT}`
  );
});
