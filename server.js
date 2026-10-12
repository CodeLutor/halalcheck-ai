const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Informational directory only. This is NOT a product certificate database.
const certificationBodies = [
  {
    name: "JAKIM",
    country: "Malaysia",
    website: "https://www.halal.gov.my/",
    recognitionStatus: "NOT YET VERIFIED",
    recognitionEvidence:
      "Check the relevant importing country's official recognition list.",
    evidenceSource: "https://www.halal.gov.my/"
  },
  {
    name: "BPJPH",
    country: "Indonesia",
    website: "https://halal.go.id/",
    recognitionStatus: "NOT YET VERIFIED",
    recognitionEvidence:
      "Check the relevant importing country's official recognition list.",
    evidenceSource: "https://halal.go.id/"
  },
  {
    name: "MUIS",
    country: "Singapore",
    website: "https://www.muis.gov.sg/",
    recognitionStatus: "NOT YET VERIFIED",
    recognitionEvidence:
      "Check the relevant importing country's official recognition list.",
    evidenceSource: "https://www.muis.gov.sg/"
  },
  {
    name: "IFANCA",
    country: "United States",
    website: "https://ifanca.org/",
    recognitionStatus: "NOT YET VERIFIED",
    recognitionEvidence:
      "Check the relevant importing country's official recognition list.",
    evidenceSource: "https://ifanca.org/"
  },
  {
    name: "Halal Food Authority",
    country: "United Kingdom",
    website: "https://halalfoodauthority.com/",
    recognitionStatus: "NOT YET VERIFIED",
    recognitionEvidence:
      "Check the relevant importing country's official recognition list.",
    evidenceSource: "https://halalfoodauthority.com/"
  }
];

app.get("/api/certification-bodies", (req, res) => {
  res.json({
    note:
      "This is an informational directory. It does not verify certification for individual products.",
    bodies: certificationBodies
  });
});

// Find ingredient terms that require attention.
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
        "The ingredient list is missing from this database record. Halal status cannot be determined from the available ingredient data.",
      flaggedIngredients: []
    };
  }

  const ingredientText = ingredients.toLowerCase();

  // These matches require checking the actual label and ingredient source.
  const potentialProhibitedRules = [
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

  const potentialProhibited = findMatches(
    ingredientText,
    potentialProhibitedRules
  );

  if (potentialProhibited.length > 0) {
    return {
      status: "POTENTIAL PROHIBITED INGREDIENT",
      explanation:
        "The database lists a term associated with a potentially prohibited ingredient: " +
        potentialProhibited.join(", ") +
        ". Check the product label and ingredient source before making a final decision. This automated match is not a definitive religious ruling.",
      flaggedIngredients: potentialProhibited
    };
  }

  const needsVerification = findMatches(
    ingredientText,
    verificationRules
  );

  if (needsVerification.length > 0) {
    return {
      status: "NEEDS VERIFICATION",
      explanation:
        "One or more ingredients may depend on their source or processing method. Halal status has not been confirmed. Check the manufacturer or a reliable certification source.",
      flaggedIngredients: needsVerification
    };
  }

  return {
    status: "UNCERTAIN",
    explanation:
      "The automated screen found no terms on its watchlist, but that does not prove the product is halal. The ingredient list and product-specific halal certification have not been independently verified.",
    flaggedIngredients: []
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
      // Barcode endpoint
      url.pathname =
        "/api/v2/product/" +
        encodeURIComponent(query) +
        ".json";

      url.searchParams.set(
        "fields",
        "code,product_name,brands,quantity,countries,ingredients_text,ingredients_text_en,image_front_url,url"
      );
    } else {
      // Product-name search endpoint
      url.pathname = "/cgi/search.pl";
      url.searchParams.set("search_terms", query);
      url.searchParams.set("sort_by", "unique_scans_n");
      url.searchParams.set("search_simple", "1");
      url.searchParams.set("action", "process");
      url.searchParams.set("json", "1");
      url.searchParams.set("page_size", "10");

      url.searchParams.set(
        "fields",
        "code,product_name,brands,quantity,countries,ingredients_text,ingredients_text_en,image_front_url,url"
      );
    }

    console.log("API request URL:", url.toString());

    const response = await fetch(url, {
      headers: {
        "User-Agent": "HalalCheckAI/0.2 (product screening app)"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const details = await response.text();

      throw new Error(
        `Product database unavailable (HTTP ${response.status}): ${details.slice(0, 300)}`
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

    console.log(
      "API results:",
      sourceProducts
        .slice(0, 3)
        .map((product) => product.product_name)
    );

    const products = sourceProducts
      .filter((product) => product.product_name && product.code)
      .map((product) => {
        const ingredients =
          product.ingredients_text_en ||
          product.ingredients_text ||
          "";

        const halalScreening = assessIngredients(ingredients);

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

          // Do not claim a product is certified without product-specific
          // evidence from a reliable source.
          certification: {
            status: "NOT VERIFIED",
            evidence:
              "No product-specific certificate lookup has been completed. The certification-body directory is informational only and does not prove that this product is certified."
          }
        };
      });

    res.json({ query, products });
  } catch (error) {
    console.error("PRODUCT API ERROR:", error);

    res.status(502).json({
      error: "Could not retrieve products. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `HalalCheck AI is running at http://localhost:${PORT}`
  );
});
