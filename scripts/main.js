document.addEventListener('DOMContentLoaded', function() {
      // --- CONFIGURATION ---
      const TARIF_NORMAL_KM = 5;
      const TARIF_MAJORE_KM = 7.5;
      const POIDS_MAX_NORMAL = 15;
      const VOLUME_MAX_NORMAL = 27000; // 30cm x 30cm x 30cm
      const PRIX_MINIMUM_STANDARD = 10;
      const PRIX_MINIMUM_URGENT = 20; // Used when a time surcharge is applied
      const MONTPELLIER_LAT = 43.610769;
      const MONTPELLIER_LON = 3.876716;
      const PREDEFINED_SUGGESTIONS = [
          { properties: { label: 'Gare de Montpellier-Saint-Roch' }, geometry: { coordinates: [3.8806, 43.6046] } },
          { properties: { label: 'Place de la Comédie, Montpellier' }, geometry: { coordinates: [3.8799, 43.6084] } },
          { properties: { label: 'Centre commercial Polygone, Montpellier' }, geometry: { coordinates: [3.8853, 43.6103] } },
          { properties: { label: 'Hôtel de Ville de Montpellier' }, geometry: { coordinates: [3.8921, 43.5944] } },
      ];

      // --- DOM ELEMENTS ---
      const form = document.getElementById('orderForm');
      const allInputs = Array.from(form.querySelectorAll('input, select, textarea'));
      const submitButton = document.getElementById('submit-button');
      const priceElement = document.getElementById('price');
      const distanceElement = document.getElementById('distance-value');
      const distanceSpinner = document.getElementById('distance-spinner');
      const distanceError = document.getElementById('distance-error');
      const priceBreakdownContainer = document.getElementById('price-breakdown');
      const pickupTimeError = document.getElementById('pickup-time-error');
      const deliveryTimeError = document.getElementById('delivery-time-error');
      const hiddenSummary = document.getElementById('hidden-summary');
      const departInput = document.getElementById('adresse_depart');
      const arriveeInput = document.getElementById('adresse_arrivee');
      const nomInput = document.getElementById('nom');
      const telInput = document.getElementById('tel');
      const telError = document.getElementById('tel-error');
      const emailInput = document.getElementById('email');
        const rememberMeCheckbox = document.getElementById('remember-me');
        const clearSavedDataBtn = document.getElementById('clear-saved-data');
        const parcelCountInput = document.getElementById('parcel_count');
      const parcelsContainer = document.getElementById('parcels-container');
      const mapContainer = document.getElementById('map');
      const floatingSummaryEl = document.getElementById('floating-summary');
      const floatingDistanceEl = document.getElementById('floating-distance');
      const floatingPriceEl = document.getElementById('floating-price');
      const dateRecuperationInput = document.getElementById('date_recuperation');
      const heureDebutRecuperationInput = document.getElementById('heure_debut_recuperation');
      const heureFinRecuperationInput = document.getElementById('heure_fin_recuperation');
      const dateLivraisonInput = document.getElementById('date_livraison');
      const heureDebutLivraisonInput = document.getElementById('heure_debut_livraison');
      const heureFinLivraisonInput = document.getElementById('heure_fin_livraison');
      const confirmationModal = document.getElementById('confirmation-modal');
      const modalSummaryContent = document.getElementById('modal-summary-content');
      const editOrderBtn = document.getElementById('edit-order-btn');
      const confirmOrderBtn = document.getElementById('confirm-order-btn');

      // --- STATE ---
      let state = {
          depart: null,
          arrivee: null,
          distance: 0,
          isPickupTimeValid: false,
          isDeliveryTimeValid: false,
          isFormFullyFilled: false,
          isCalculatingDistance: false,
          pricing: {},
      };
      let map = null;
      let routeLayer = null;
      let debounceTimer;

      // --- POLYLINE DECODER (from Valhalla) ---
      function decode(str, precision) {
        var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change,
            factor = Math.pow(10, precision || 6);
        while (index < str.length) {
            byte = null; shift = 0; result = 0;
            do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
            latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
            shift = result = 0;
            do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
            longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += latitude_change; lng += longitude_change;
            coordinates.push([lat / factor, lng / factor]);
        }
        return coordinates;
      };

      // --- MAP FUNCTIONS ---
      function initMap() {
        if (map) return;
        map = L.map('map').setView([MONTPELLIER_LAT, MONTPELLIER_LON], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
      }

      function updateMapRoute(route) {
        initMap();
        mapContainer.style.display = 'block';

        if (routeLayer) {
            routeLayer.remove();
        }

        const startCoords = [state.depart.geometry.coordinates[1], state.depart.geometry.coordinates[0]];
        const endCoords = [state.arrivee.geometry.coordinates[1], state.arrivee.geometry.coordinates[0]];

        const startMarker = L.marker(startCoords);
        const endMarker = L.marker(endCoords);
        
        const decodedPolyline = decode(route.geometry, 5); // OSRM uses polyline with precision 5
        const polyline = L.polyline(decodedPolyline, { color: 'var(--primary-color)', weight: 5 });

        routeLayer = L.featureGroup([startMarker, endMarker, polyline]).addTo(map);
        map.fitBounds(routeLayer.getBounds().pad(0.1));
        
        setTimeout(() => map.invalidateSize(), 100);
      }

      // --- AUTOCOMPLETE ---
      function setupAutocomplete(input, onSelect) {
        let suggestionsContainer;

        input.addEventListener('focus', () => {
            if (input.value.length === 0) {
                showSuggestions(PREDEFINED_SUGGESTIONS, true);
            }
        });

        input.addEventListener('input', () => {
            const query = input.value;
            if (query.length < 2) {
                onSelect(null);
                removeSuggestions();
                return;
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    const response = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&lat=${MONTPELLIER_LAT}&lon=${MONTPELLIER_LON}&limit=5`);
                    const data = await response.json();
                    showSuggestions(data.features, false);
                } catch (error) {
                    console.error('Error fetching addresses:', error);
                    removeSuggestions();
                }
            }, 300);
        });

        function showSuggestions(features, isPredefined) {
          removeSuggestions();
          suggestionsContainer = document.createElement('div');
          suggestionsContainer.className = 'autocomplete-suggestions';
          input.parentNode.appendChild(suggestionsContainer);

          features.forEach(feature => {
            const suggestion = document.createElement('div');
            suggestion.className = 'autocomplete-suggestion';
            suggestion.textContent = feature.properties.label;
            suggestion.addEventListener('click', () => {
              input.value = feature.properties.label;
              onSelect(feature);
              removeSuggestions();
            });
            suggestionsContainer.appendChild(suggestion);
          });
        }

        function removeSuggestions() {
          if (suggestionsContainer) {
            suggestionsContainer.remove();
            suggestionsContainer = null;
          }
        }
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.input-wrapper')) removeSuggestions();
        });
      }

      setupAutocomplete(departInput, (feature) => { 
          state.depart = feature;
          if(feature && state.arrivee) fetchDistance(); else updateUI();
      });
      setupAutocomplete(arriveeInput, (feature) => { 
          state.arrivee = feature;
          if(feature && state.depart) fetchDistance(); else updateUI();
      });

      // --- PARCEL MANAGEMENT ---
      function generateParcelFields() {
          parcelsContainer.textContent = '';
          const count = parseInt(parcelCountInput.value) || 1;
          for (let i = 1; i <= count; i++) {
              const parcelGroup = document.createElement('div');
              parcelGroup.className = 'parcel-group';

              const heading = document.createElement('h3');
              heading.textContent = `Colis ${i}`;
              parcelGroup.appendChild(heading);

              const grid = document.createElement('div');
              grid.className = 'form-grid';

              const poidsInput = document.createElement('input');
              poidsInput.type = 'number';
              poidsInput.name = `poids_${i}`;
              poidsInput.placeholder = 'Poids (kg, ex: 0.5)';
              poidsInput.min = '0';
              poidsInput.step = '0.01';
              poidsInput.required = true;
              grid.appendChild(poidsInput);

              const longueurInput = document.createElement('input');
              longueurInput.type = 'number';
              longueurInput.name = `longueur_${i}`;
              longueurInput.placeholder = 'Longueur (cm)';
              longueurInput.min = '0';
              grid.appendChild(longueurInput);

              const largeurInput = document.createElement('input');
              largeurInput.type = 'number';
              largeurInput.name = `largeur_${i}`;
              largeurInput.placeholder = 'Largeur (cm)';
              largeurInput.min = '0';
              grid.appendChild(largeurInput);

              const hauteurInput = document.createElement('input');
              hauteurInput.type = 'number';
              hauteurInput.name = `hauteur_${i}`;
              hauteurInput.placeholder = 'Hauteur (cm)';
              hauteurInput.min = '0';
              grid.appendChild(hauteurInput);

              parcelGroup.appendChild(grid);
              parcelsContainer.appendChild(parcelGroup);
          }
          parcelsContainer.querySelectorAll('input').forEach(input => input.addEventListener('input', updateUI));
          updateUI();
      }

      // --- LOCAL STORAGE ---
      const AES_KEY = '12345678901234567890123456789012';
      async function encryptData(plainText) {
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-GCM' }, false, ['encrypt']);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText));
          const combined = new Uint8Array(iv.length + cipher.byteLength);
          combined.set(iv);
          combined.set(new Uint8Array(cipher), iv.length);
          return btoa(String.fromCharCode(...combined));
      }
      async function decryptData(cipherText) {
          const data = Uint8Array.from(atob(cipherText), c => c.charCodeAt(0));
          const iv = data.slice(0, 12);
          const cipher = data.slice(12);
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-GCM' }, false, ['decrypt']);
          const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
          return new TextDecoder().decode(plainBuffer);
      }

      async function loadUserInfo() {
        if (localStorage.getItem('lcmUserRemember') === 'true') {
            const encrypted = localStorage.getItem('lcmUserInfo');
            if (encrypted) {
              try {
                const decrypted = await decryptData(encrypted);
                const savedInfo = JSON.parse(decrypted);
                if (savedInfo.expiresAt && savedInfo.expiresAt < Date.now()) {
                  localStorage.removeItem('lcmUserInfo');
                } else {
                  nomInput.value = savedInfo.nom || '';
                  emailInput.value = savedInfo.email || '';
                  telInput.value = savedInfo.tel || '';
                }
              } catch (e) {
                console.error('Unable to decrypt user info', e);
                localStorage.removeItem('lcmUserInfo');
              }
            }
            rememberMeCheckbox.checked = true;
        }
      }

      async function saveUserInfo() {
          if (rememberMeCheckbox.checked) {
              const userInfo = { nom: nomInput.value, email: emailInput.value, tel: telInput.value, expiresAt: Date.now() + 30*24*60*60*1000 };
              const encrypted = await encryptData(JSON.stringify(userInfo));
              localStorage.setItem('lcmUserInfo', encrypted);
          }
      }

      function handleRememberMeChange() {
          localStorage.setItem('lcmUserRemember', rememberMeCheckbox.checked);
          if (!rememberMeCheckbox.checked) {
              localStorage.removeItem('lcmUserInfo');
          }
      }

      // --- PRICING LOGIC ---
      function calculatePrice(distance, totalPoids, isVolumeMajore, pickupWindowHours) {
        const isTarifMajore = totalPoids > POIDS_MAX_NORMAL || isVolumeMajore;
        const currentTariff = isTarifMajore ? TARIF_MAJORE_KM : TARIF_NORMAL_KM;
        
        let poidsMajoreReason = totalPoids > POIDS_MAX_NORMAL ? `(poids total > ${POIDS_MAX_NORMAL} kg)` : '';
        let volumeMajoreReason = isVolumeMajore ? `(volume > ${VOLUME_MAX_NORMAL} cm³)`: '';
        let tarifReason = [poidsMajoreReason, volumeMajoreReason].filter(Boolean).join(' et ');

        const prix_base = distance * currentTariff;

        let timeSurchargePercentage = 0;
        let timeSurchargeReason = '';
        if (pickupWindowHours <= 1) {
            timeSurchargePercentage = 1; // 100%
            timeSurchargeReason = 'Créneau ≤ 1h';
        } else if (pickupWindowHours < 2) {
            timeSurchargePercentage = 0.75; // 75%
            timeSurchargeReason = 'Créneau < 2h';
        } else if (pickupWindowHours < 4) {
            timeSurchargePercentage = 0.5; // 50%
            timeSurchargeReason = 'Créneau < 4h';
        }
        
        const timeSurchargeAmount = prix_base * timeSurchargePercentage;
        const subtotal = prix_base + timeSurchargeAmount;
        
        const isUrgent = timeSurchargePercentage > 0;
        const minimumPrice = isUrgent ? PRIX_MINIMUM_URGENT : PRIX_MINIMUM_STANDARD;
        const prix_final = Math.max(subtotal, minimumPrice);
        const minimumApplied = prix_final > subtotal;

        return {
            isTarifMajore,
            currentTariff,
            tarifReason,
            prix_base,
            timeSurchargeAmount,
            timeSurchargePercentage,
            timeSurchargeReason,
            subtotal,
            minimumPrice,
            prix_final,
            minimumApplied
        };
    }

      // --- CORE FUNCTIONS ---
      async function fetchDistance() {
        if (!state.depart || !state.arrivee || state.isCalculatingDistance) return;
        state.isCalculatingDistance = true;
        updateUI();

        const lon1 = state.depart.geometry.coordinates[0];
        const lat1 = state.depart.geometry.coordinates[1];
        const lon2 = state.arrivee.geometry.coordinates[0];
        const lat2 = state.arrivee.geometry.coordinates[1];

        // Using OSRM for routing
        const osrmRequestUrl = `https://router.project-osrm.org/route/v1/bicycle/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=polyline`;

        try {
          const response = await fetch(osrmRequestUrl);
          const data = await response.json();

          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            state.distance = route.distance / 1000; // OSRM gives distance in meters
            updateMapRoute(route);
            distanceError.textContent = "";
          } else {
            state.distance = -1;
            distanceError.textContent = "Impossible de calculer la distance.";
            console.error("OSRM error: Invalid route response", data);
          }
        } catch (error) {
          console.error("Distance calculation error:", error);
          state.distance = -1;
          distanceError.textContent = "Impossible de calculer la distance.";
        } finally {
          state.isCalculatingDistance = false;
          updateUI();
        }
      }

      function updateUI() {
        // --- Get Parcel Info ---
        let totalPoids = 0;
        let isVolumeMajore = false;
        document.querySelectorAll('.parcel-group').forEach((group, index) => {
            const poids = parseFloat(group.querySelector(`input[name=poids_${index+1}]`).value) || 0;
            const longueur = parseFloat(group.querySelector(`input[name=longueur_${index+1}]`).value) || 0;
            const largeur = parseFloat(group.querySelector(`input[name=largeur_${index+1}]`).value) || 0;
            const hauteur = parseFloat(group.querySelector(`input[name=hauteur_${index+1}]`).value) || 0;
            totalPoids += poids;
            if (longueur * largeur * hauteur > VOLUME_MAX_NORMAL) {
                isVolumeMajore = true;
            }
        });

        // --- Validations ---
        const dateRecuperationValue = dateRecuperationInput.value;
        const heureDebutRecuperationValue = heureDebutRecuperationInput.value;
        const heureFinRecuperationValue = heureFinRecuperationInput.value;
        const dateLivraisonValue = dateLivraisonInput.value;
        const heureDebutLivraisonValue = heureDebutLivraisonInput.value;
        const heureFinLivraisonValue = heureFinLivraisonInput.value;

        let pickupWindowHours = Infinity;
        if (!dateRecuperationValue || !heureDebutRecuperationValue || !heureFinRecuperationValue) {
          state.isPickupTimeValid = false;
        } else {
            const startPickupDateTime = new Date(`${dateRecuperationValue}T${heureDebutRecuperationValue}`);
            const endPickupDateTime = new Date(`${dateRecuperationValue}T${heureFinRecuperationValue}`);
            state.isPickupTimeValid = startPickupDateTime < endPickupDateTime;
            if(state.isPickupTimeValid) {
                pickupWindowHours = (endPickupDateTime - startPickupDateTime) / (1000 * 60 * 60);
            }
        }

        if (!dateLivraisonValue || !heureDebutLivraisonValue || !heureFinLivraisonValue || !dateRecuperationValue || !heureDebutRecuperationValue) {
            state.isDeliveryTimeValid = false;
        } else {
            const startPickupDateTime = new Date(`${dateRecuperationValue}T${heureDebutRecuperationValue}`);
            const startDeliveryDateTime = new Date(`${dateLivraisonValue}T${heureDebutLivraisonValue}`);
            const endDeliveryDateTime = new Date(`${dateLivraisonValue}T${heureFinLivraisonValue}`);
            state.isDeliveryTimeValid = startDeliveryDateTime > startPickupDateTime && startDeliveryDateTime < endDeliveryDateTime;
        }

        state.isFormFullyFilled = allInputs.every(field => !field.required || field.value.trim() !== '') && telInput.checkValidity();

        // --- Calculate Price ---
        state.pricing = calculatePrice(state.distance, totalPoids, isVolumeMajore, pickupWindowHours);

        // --- DOM Updates ---
        pickupTimeError.style.display = (dateRecuperationValue && heureDebutRecuperationValue && heureFinRecuperationValue && !state.isPickupTimeValid) ? 'block' : 'none';
        deliveryTimeError.style.display = (dateLivraisonValue && heureDebutLivraisonValue && heureFinLivraisonValue && !state.isDeliveryTimeValid) ? 'block' : 'none';
        telError.style.display = telInput.value && !telInput.checkValidity() ? 'block' : 'none';

        distanceSpinner.style.display = state.isCalculatingDistance ? 'inline-block' : 'none';
        priceElement.style.color = state.isCalculatingDistance ? 'var(--greyed-out-color)' : 'var(--primary-color)';

        distanceElement.textContent = state.distance === -1 ? "Erreur" : (state.distance > 0 ? `${state.distance.toFixed(2)} km` : '-- km');
        
        // Manage map display
        if (state.distance <= 0) { // Only manage single markers if no route is drawn
            if (state.depart || state.arrivee) {
                initMap();
                mapContainer.style.display = 'block';
                if (routeLayer) {
                    routeLayer.remove();
                }
                
                let markers = [];
                let targetCoords;
                if (state.depart) {
                    const coords = [state.depart.geometry.coordinates[1], state.depart.geometry.coordinates[0]];
                    markers.push(L.marker(coords));
                    targetCoords = coords;
                }
                if (state.arrivee) {
                    const coords = [state.arrivee.geometry.coordinates[1], state.arrivee.geometry.coordinates[0]];
                    markers.push(L.marker(coords));
                    targetCoords = coords; // Last one becomes the focus
                }
                
                if (markers.length > 0) {
                    routeLayer = L.featureGroup(markers).addTo(map);
                    map.setView(targetCoords, 14);
                    setTimeout(() => map.invalidateSize(), 100);
                }

            } else {
                // No addresses selected
                mapContainer.style.display = 'none';
                if (routeLayer) {
                    routeLayer.remove();
                    routeLayer = null;
                }
            }
        }

        priceBreakdownContainer.textContent = '';
        if (state.distance > 0) {
            const p = state.pricing;
            const tariffP = document.createElement('p');
            tariffP.className = 'price-breakdown';
            tariffP.textContent = 'Tarif au km: ';
            const tariffSpan = document.createElement('span');
            tariffSpan.textContent = `${p.currentTariff.toFixed(2)} €`;
            tariffP.appendChild(tariffSpan);
            if (p.isTarifMajore) {
                const reasonSpan = document.createElement('span');
                reasonSpan.className = 'reason';
                reasonSpan.textContent = p.tarifReason;
                tariffP.appendChild(reasonSpan);
            }
            priceBreakdownContainer.appendChild(tariffP);

            const baseP = document.createElement('p');
            baseP.className = 'price-breakdown price-result';
            baseP.textContent = 'Prix de base: ';
            const baseSpan = document.createElement('span');
            baseSpan.textContent = `${state.distance.toFixed(2)} km × ${p.currentTariff.toFixed(2)} €/km = ${p.prix_base.toFixed(2)} €`;
            baseP.appendChild(baseSpan);
            priceBreakdownContainer.appendChild(baseP);

            if(p.timeSurchargePercentage > 0) {
                const surchargeP = document.createElement('p');
                surchargeP.className = 'price-breakdown';
                surchargeP.textContent = `Majoration (${state.pricing.timeSurchargeReason} / +${state.pricing.timeSurchargePercentage * 100}%): +${state.pricing.timeSurchargeAmount.toFixed(2)} €`;
                priceBreakdownContainer.appendChild(surchargeP);

                const subtotalP = document.createElement('p');
                subtotalP.className = 'price-breakdown price-result';
                subtotalP.textContent = 'Sous-total: ';
                const subtotalSpan = document.createElement('span');
                subtotalSpan.textContent = `${p.prix_base.toFixed(2)} € + ${p.timeSurchargeAmount.toFixed(2)} € = ${p.subtotal.toFixed(2)} €`;
                subtotalP.appendChild(subtotalSpan);
                priceBreakdownContainer.appendChild(subtotalP);
            }

            if(p.minimumApplied) {
                const type = p.timeSurchargePercentage > 0 ? 'urgente' : 'standard';
                const minimumP = document.createElement('p');
                minimumP.className = 'price-breakdown';
                const italic = document.createElement('i');
                italic.textContent = `Un minimum de ${p.minimumPrice.toFixed(2)}€ s'applique pour une course ${type}.`;
                minimumP.appendChild(italic);
                priceBreakdownContainer.appendChild(minimumP);
            }
            priceElement.textContent = p.prix_final.toFixed(2) + ' €';
            priceElement.classList.add('price-updated');
            floatingPriceEl.classList.add('price-updated');
            setTimeout(() => {
                priceElement.classList.remove('price-updated');
                floatingPriceEl.classList.remove('price-updated');
            }, 400);

            // Update floating summary
            floatingDistanceEl.textContent = `${state.distance.toFixed(2)} km`;
            floatingPriceEl.textContent = `${p.prix_final.toFixed(2)} €`;
            floatingSummaryEl.classList.add('visible');

        } else {
            priceBreakdownContainer.textContent = '';
            priceElement.textContent = '-- €';
            // Hide floating summary
            floatingSummaryEl.classList.remove('visible');
        }

        // --- Button State ---
        if (state.isCalculatingDistance) {
            submitButton.disabled = true;
            submitButton.textContent = 'Calcul en cours...';
        } else if (state.depart && state.arrivee && state.isPickupTimeValid && state.isDeliveryTimeValid && state.isFormFullyFilled) {
          submitButton.disabled = false;
          submitButton.textContent = 'Envoyer ma commande';
        } else {
          submitButton.disabled = true;
          submitButton.textContent = 'Veuillez remplir tout le formulaire';
        }
      }

      function generateSummary() {
        if (!state.isFormFullyFilled || !state.pricing.prix_final || !state.depart || !state.arrivee) return;
        let parcelsSummary = `Nombre de colis: ${parcelCountInput.value}`;
        document.querySelectorAll('.parcel-group').forEach((group, index) => {
            const i = index + 1;
            const poids = group.querySelector(`input[name=poids_${i}]`).value || '0';
            const l = group.querySelector(`input[name=longueur_${i}]`).value || 'N/A';
            const w = group.querySelector(`input[name=largeur_${i}]`).value || 'N/A';
            const h = group.querySelector(`input[name=hauteur_${i}]`).value || 'N/A';
            parcelsSummary += `
  - Colis ${i}: ${poids} kg, ${l}x${w}x${h} cm`;
        });

        let priceBreakdownText = `
          Prix de la course: ${state.pricing.prix_base.toFixed(2)} €`;
        if (state.pricing.timeSurchargePercentage > 0) {
            priceBreakdownText += `
          Majoration (${state.pricing.timeSurchargeReason} / +${state.pricing.timeSurchargePercentage * 100}%): +${state.pricing.timeSurchargeAmount.toFixed(2)} €`;
        }
        if (state.pricing.minimumApplied) {
            priceBreakdownText += `
          Un minimum de ${state.pricing.minimumPrice.toFixed(2)}€ a été appliqué.`
        }

        const summaryText = `
          --- Résumé de la Commande ---
          Client: ${nomInput.value}
Email: ${emailInput.value}
Téléphone: ${telInput.value}
          
--- Course ---
          Départ: ${state.depart.properties.label}
Arrivée: ${state.arrivee.properties.label}
Distance (vélo): ${state.distance.toFixed(2)} km
Créneau de récupération: ${dateRecuperationInput.value} entre ${heureDebutRecuperationInput.value} et ${heureFinRecuperationInput.value}
Créneau de livraison: ${dateLivraisonInput.value} entre ${heureDebutLivraisonInput.value} et ${heureFinLivraisonInput.value}
          
--- Colis ---
          ${parcelsSummary}
          Poids total: ${document.querySelectorAll('.parcel-group').length > 0 ? (Array.from(document.querySelectorAll('input[name^=poids]')).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0)).toFixed(2) : 'N/A'} kg
          
--- Prix Total Estimé ---
          ${state.pricing.prix_final.toFixed(2)} € (Basé sur un tarif de ${state.pricing.currentTariff.toFixed(2)} €/km)
          ${priceBreakdownText}
          
--- Liens Rapides ---
          Itinéraire (vélo): https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${encodeURIComponent(state.depart.properties.label)}&destination=${encodeURIComponent(state.arrivee.properties.label)}
        `;
        hiddenSummary.value = summaryText;
      }

      // --- EVENT LISTENERS ---
      allInputs.forEach(input => {
          input.addEventListener('input', updateUI);
      });
        parcelCountInput.addEventListener('input', generateParcelFields);
        rememberMeCheckbox.addEventListener('change', handleRememberMeChange);
        clearSavedDataBtn.addEventListener('click', () => {
          localStorage.removeItem('lcmUserInfo');
          localStorage.removeItem('lcmUserRemember');
          nomInput.value = '';
          emailInput.value = '';
          telInput.value = '';
          rememberMeCheckbox.checked = false;
        });
        form.addEventListener('submit', (e) => {
          e.preventDefault(); // Prevent actual submission
          generateSummary();
          modalSummaryContent.textContent = '';
          const sanitize = value => (value == null ? '' : String(value));
        const createSummaryItem = (label, value) => {
            const item = document.createElement('div');
            item.className = 'modal-summary-item';
            const span = document.createElement('span');
            span.textContent = sanitize(label);
            const strong = document.createElement('strong');
            strong.textContent = sanitize(value);
            item.append(span, document.createTextNode(' '), strong);
            return item;
        };
        modalSummaryContent.append(
            createSummaryItem('Départ:', state.depart.properties.label),
            createSummaryItem('Arrivée:', state.arrivee.properties.label),
            createSummaryItem('Créneau de récupération:', `${dateRecuperationInput.value} entre ${heureDebutRecuperationInput.value} et ${heureFinRecuperationInput.value}`),
            createSummaryItem('Créneau de livraison:', `${dateLivraisonInput.value} entre ${heureDebutLivraisonInput.value} et ${heureFinLivraisonInput.value}`),
            createSummaryItem('Nombre de colis:', parcelCountInput.value),
            createSummaryItem('Poids total:', `${(Array.from(document.querySelectorAll('input[name^=poids]')).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0)).toFixed(2)} kg`),
            createSummaryItem('Total estimé:', `${state.pricing.prix_final.toFixed(2)} €`)
        );
        confirmationModal.classList.add('visible');
      });

      editOrderBtn.addEventListener('click', () => {
        confirmationModal.classList.remove('visible');
      });

        confirmOrderBtn.addEventListener('click', async () => {
          if (rememberMeCheckbox.checked) {
            const consent = confirm("Nous enregistrerons votre nom, email et téléphone dans votre navigateur pendant 30 jours. Acceptez-vous ?");
            if (consent) {
              await saveUserInfo();
            }
          }
          console.log('Formulaire envoyé');
          form.submit();
        });

        // --- INITIALIZATION ---
        loadUserInfo();
        generateParcelFields();
        updateUI();
      });
