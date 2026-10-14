const carsContainer = document.getElementById("carsContainer");
const searchInput = document.getElementById("searchInput");
const priceRange = document.getElementById("priceRange");
const priceValue = document.getElementById("priceValue");
const loading = document.getElementById("loading");
const dataStatus = document.getElementById("dataStatus");

const VPIC_API_URL = "https://vpic.nhtsa.dot.gov/api/vehicles";

let allCars = [];
let carsLoaded = false;
let filterTimer;

const FALLBACK_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360"><rect width="600" height="360" fill="#272727"/><path d="M140 220h320l-30-75c-6-16-20-25-38-25H218c-18 0-32 9-38 25l-40 75zm-20 20v35h45a35 35 0 0 1 70 0h130a35 35 0 0 1 70 0h45v-60H120v25zm60-90h210l20 50H160l20-50z" fill="#00ff88"/><text x="300" y="330" text-anchor="middle" fill="#e0e0e0" font-family="Arial,sans-serif" font-size="22">Image unavailable</text></svg>',
)}`;

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function modelAliases(make, model) {
  const key = `${normalize(make)}|${normalize(model)}`;
  const aliases = {
    "bmw|3series": ["330i", "340i", "m340i", "m3"],
    "bmw|5series": ["530i", "540i", "m550i", "m5"],
    "mazda|mx5miata": ["mx5"],
    "mercedesbenz|glc": ["glcclass"],
    "mercedesbenz|gle": ["gleclass"],
    "audi|rs7": ["rs7sportback"],
    "volkswagen|golf": ["golfgti", "golfr"],
    "dodge|ram1500": ["1500"],
    "gmc|sierra1500": ["sierra"],
    "gmc|hummerev": ["hummerevpickup"],
  };

  return aliases[key] ?? [];
}

function findApiModel(models, make, model) {
  const wanted = normalize(model);
  const matchingMake = models.filter((apiModel) => {
    const makeMatches =
      normalize(apiModel.Make_Name) === normalize(make) ||
      (normalize(make) === "dodge" &&
        normalize(model) === "ram1500" &&
        normalize(apiModel.Make_Name) === "ram");

    return makeMatches;
  });

  const exactMatch = matchingMake.find(
    (apiModel) => normalize(apiModel.Model_Name) === wanted,
  );
  if (exactMatch) return { ...exactMatch, apiMatchType: "exact" };

  for (const alias of modelAliases(make, model)) {
    const familyMatch = matchingMake.find(
      (apiModel) => normalize(apiModel.Model_Name) === alias,
    );
    if (familyMatch) return { ...familyMatch, apiMatchType: "variant" };
  }

  return undefined;
}

async function fetchModelsForMakeYear(make, year) {
  const url = `${VPIC_API_URL}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `NHTSA API request failed for ${make} ${year} (${response.status})`,
    );
  }

  const payload = await response.json();
  if (!Array.isArray(payload.Results)) {
    throw new Error(
      `NHTSA API returned an invalid response for ${make} ${year}`,
    );
  }

  return {
    url,
    models: payload.Results.filter(
      (result) => normalize(result.Make_Name) === normalize(make),
    ).map((result) => ({ ...result, apiSourceUrl: url })),
  };
}

async function fetchVehicleCatalog(cars) {
  const groups = new Map();

  cars.forEach((car) => {
    const key = `${normalize(car.make)}|${car.year}`;
    if (!groups.has(key)) {
      groups.set(key, { make: car.make, year: car.year, cars: [] });
    }
    groups.get(key).cars.push(car);
  });

  const requests = [];
  groups.forEach((group, key) => {
    const apiMakes = new Set([group.make]);
    if (
      normalize(group.make) === "dodge" &&
      group.cars.some((car) => normalize(car.model) === "ram1500")
    ) {
      apiMakes.add("RAM");
    }

    apiMakes.forEach((apiMake) => requests.push({ key, ...group, apiMake }));
  });

  const results = new Map(
    [...groups.keys()].map((key) => [key, { models: [] }]),
  );
  let nextRequest = 0;

  async function runWorker() {
    while (nextRequest < requests.length) {
      const request = requests[nextRequest];
      nextRequest += 1;
      const apiResult = await fetchModelsForMakeYear(
        request.apiMake,
        request.year,
      );
      results.get(request.key).models.push(...apiResult.models);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, requests.length) }, () => runWorker()),
  );

  return results;
}

function showSkeleton() {
  carsContainer.replaceChildren();
  carsContainer.setAttribute("aria-busy", "true");

  for (let index = 0; index < 6; index += 1) {
    const skeleton = document.createElement("div");
    skeleton.classList.add("car", "skeleton");
    skeleton.innerHTML = `
      <div class="img-skeleton"></div>
      <div class="text-skeleton"></div>
      <div class="text-skeleton short"></div>
    `;
    carsContainer.appendChild(skeleton);
  }
}

async function loadCars() {
  if (loading) loading.hidden = false;
  carsContainer.hidden = false;
  showSkeleton();
  dataStatus.textContent =
    "Fetching verified vehicle data from the NHTSA API...";

  try {
    const response = await fetch("./cars.json");
    if (!response.ok) {
      throw new Error(
        `Failed to load supplemental car details (${response.status})`,
      );
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(
        "cars.json must contain an array of supplemental car details.",
      );
    }

    const apiCatalog = await fetchVehicleCatalog(data);
    allCars = data.flatMap((car) => {
      const key = `${normalize(car.make)}|${car.year}`;
      const apiResult = apiCatalog.get(key);
      const apiModel = findApiModel(apiResult.models, car.make, car.model);

      return apiModel
        ? [
            {
              ...car,
              apiModelName: apiModel.Model_Name,
              apiMatchType: apiModel.apiMatchType,
              apiSourceUrl: apiModel.apiSourceUrl,
            },
          ]
        : [];
    });

    if (allCars.length === 0) {
      throw new Error(
        "The NHTSA API returned no matching models for this catalog.",
      );
    }

    // CLEAN UI VERSION — SHORT, PROFESSIONAL, NO LONG PARAGRAPH
    dataStatus.textContent = `Vehicle data successfully verified using the NHTSA vPIC API (${allCars.length} models matched).`;

    carsLoaded = true;
    filterCars();
  } catch (error) {
    console.error("Error loading cars:", error);
    dataStatus.textContent =
      "Could not fetch vehicle models from the NHTSA API. Check your connection and try again.";
    carsContainer.replaceChildren();
    const message = document.createElement("p");
    message.className = "no-results";
    message.textContent =
      "Vehicle listings require a connection to the NHTSA vPIC API. Open this page through a local web server and try again.";
    carsContainer.appendChild(message);
    carsContainer.setAttribute("aria-busy", "false");
  } finally {
    if (loading) loading.hidden = true;
    carsContainer.hidden = false;
  }
}

function filterCars() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const maxPrice = Number(priceRange.value);

  const matchingCars = allCars.filter((car) => {
    const make = String(car.make ?? "").toLowerCase();
    const model = String(car.model ?? "").toLowerCase();
    const price = Number(car.price);

    return (
      (!searchTerm ||
        make.includes(searchTerm) ||
        model.includes(searchTerm)) &&
      Number.isFinite(price) &&
      price <= maxPrice
    );
  });

  renderCars(matchingCars);
}

function renderCars(cars) {
  carsContainer.replaceChildren();
  carsContainer.setAttribute("aria-busy", "false");

  if (cars.length === 0) {
    const message = document.createElement("p");
    message.className = "no-results";
    message.textContent = "No cars found.";
    carsContainer.appendChild(message);
    return;
  }

  cars.slice(0, 6).forEach((car) => {
    const carCard = document.createElement("div");
    carCard.classList.add("car");

    const image = document.createElement("img");
    image.src =
      typeof car.image === "string" && car.image.trim()
        ? car.image.trim()
        : FALLBACK_IMAGE;
    image.alt = `${car.make ?? "Car"} ${car.model ?? ""}`.trim();
    image.loading = "lazy";
    image.style.height = "150px";
    image.style.objectFit = "cover";
    image.onerror = () => {
      image.onerror = null;
      image.src = FALLBACK_IMAGE;
    };

    const title = document.createElement("h3");
    title.textContent = `${car.make ?? ""} ${car.model ?? ""}`.trim();

    const year = document.createElement("p");
    year.textContent = String(car.year ?? "");

    const apiSource = document.createElement("a");
    apiSource.className = "api-source";
    apiSource.href = car.apiSourceUrl;
    apiSource.textContent =
      car.apiMatchType === "variant"
        ? `NHTSA model variant: ${car.apiModelName}`
        : `NHTSA model: ${car.apiModelName}`;
    apiSource.target = "_blank";
    apiSource.rel = "noopener noreferrer";

    const price = document.createElement("span");
    price.className = "price";
    price.textContent = `$${Number(car.price).toLocaleString()}`;

    carCard.append(image);
    if (car.imageSource) {
      const credit = document.createElement("a");
      credit.href = car.imageSource;
      credit.textContent = car.imageCredit
        ? `Photo: ${car.imageCredit}`
        : "Photo source";
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      carCard.appendChild(credit);
    }
    carCard.append(title, year, apiSource, price);
    carsContainer.appendChild(carCard);
  });
}

function scheduleFilter() {
  if (!carsLoaded) return;

  clearTimeout(filterTimer);
  if (loading) loading.hidden = false;
  carsContainer.hidden = false;
  showSkeleton();

  filterTimer = setTimeout(() => {
    filterCars();
    carsContainer.hidden = false;
    if (loading) loading.hidden = true;
  }, 350);
}

searchInput.addEventListener("input", scheduleFilter);

priceRange.addEventListener("input", () => {
  priceValue.textContent = `$${Number(priceRange.value).toLocaleString()}`;
  scheduleFilter();
});

priceValue.textContent = `$${Number(priceRange.value).toLocaleString()}`;
loadCars();
