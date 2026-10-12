const carsContainer = document.getElementById("carsContainer");
const searchInput = document.getElementById("searchInput");
const priceRange = document.getElementById("priceRange");
const priceValue = document.getElementById("priceValue");
const loading = document.getElementById("loading");

let allCars = [];
let carsLoaded = false;
let filterTimer;

const FALLBACK_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360"><rect width="600" height="360" fill="#272727"/><path d="M140 220h320l-30-75c-6-16-20-25-38-25H218c-18 0-32 9-38 25l-40 75zm-20 20v35h45a35 35 0 0 1 70 0h130a35 35 0 0 1 70 0h45v-60H120v25zm60-90h210l20 50H160l20-50z" fill="#00ff88"/><text x="300" y="330" text-anchor="middle" fill="#e0e0e0" font-family="Arial,sans-serif" font-size="22">Image unavailable</text></svg>',
)}`;

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

  try {
    const response = await fetch("./cars.json");
    if (!response.ok) {
      throw new Error(`Failed to load cars.json (${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("cars.json must contain an array of cars.");
    }

    allCars = data;
    carsLoaded = true;
    filterCars();
  } catch (error) {
    console.error("Error loading cars:", error);
    carsContainer.textContent =
      "Could not load cars. Check cars.json and open this page through a local web server.";
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
    carCard.append(title, year, price);
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
