import OlFeature from 'ol/feature';
import OlOverlay from 'ol/overlay';
import OlLayerVector from 'ol/layer/vector';
import OlSourceVector from 'ol/source/vector';
import OlStyleFill from 'ol/style/fill';
import OlStyleStroke from 'ol/style/stroke';
import OlStyleCircle from 'ol/style/circle';
import OlStyleStyle from 'ol/style/style';
import OlGeomMultiLineString from 'ol/geom/multilinestring';
import lodashEach from 'lodash/each';
import lodashDebounce from 'lodash/debounce';

import { getEventById } from './util';
import {
  naturalEventsPointToGeoJSON,
  naturalEventsGetClusterPoints,
  naturalEventsCreateClusterObject,
  sortCluster
} from './cluster';
import {
  mapUtilZoomAction
} from '../map/util';

const firstClusterObj = naturalEventsCreateClusterObject();
const secondClusterObj = naturalEventsCreateClusterObject();

export default function naturalEventsTrack (models, ui, config) {
  var self = {};
  var model = models.naturalEvents;
  self.trackDetails = {};
  self.active = false;
  var init = function() {
    const map = ui.map.selected;
    map.on('moveend', function (e) {
      if (self.active) {
        let selectedEvent = ui.naturalEvents.selected;
        if (selectedEvent.date) {
          let event = getEventById(model.data.events, selectedEvent.id);
          debounceTrackUpdate(event, selectedEvent.date, map, ui.naturalEvents.selectEvent);
        }
      }
    });
    map.getView().on('propertychange', function(e) {
      if (e.key === 'resolution') {
        self.trackDetails = (self.trackDetails.id) ? self.removeTrack(map, self.trackDetails) : {};
      }
    });
    ui.sidebar.events.on('selectTab', function (tab) {
      if (tab === 'events') {
        let selectedEvent = ui.naturalEvents.selected;
        if (selectedEvent.date) {
          let event = getEventById(model.data.events, selectedEvent.id);
          self.update(event, map, selectedEvent.date, ui.naturalEvents.selectEvent);
        }
      } else {
        if (self.trackDetails.id) self.update(null, map);
      }
    });
  };
  self.update = function(event, map, selectedDate, callback) {
    var newTrackDetails;
    var trackDetails = self.trackDetails;
    if (!event || event.geometries.length < 2) {
      // If track exists remove it.
      // Else return empty Object
      newTrackDetails = (trackDetails.id) ? self.removeTrack(map, trackDetails) : {};
      self.active = false;
    } else if (trackDetails.id) {
      if (trackDetails.id === event.id) {
        // If same Track but different selection
        // Just update classNames
        if (trackDetails.selectedDate !== selectedDate) {
          let isClusteredSelection = !(document.getElementById('track-marker-' + selectedDate));
          // If New Date is in cluster
          // build new track
          if (isClusteredSelection) {
            newTrackDetails = self.removeTrack(map, trackDetails);
            newTrackDetails = createTrack(event, map, selectedDate, callback);
            map.addLayer(newTrackDetails.track);
          } else {
            newTrackDetails = trackDetails;
            updateSelection(selectedDate);
            newTrackDetails.selectedDate = selectedDate;
          }
        } else {
          // If the date and event are the same
          // Return the same Object and do nothing
          return self.trackDetails;
        }
      } else {
        // Remove old DOM Elements
        newTrackDetails = self.removeTrack(map, trackDetails);
        newTrackDetails = createTrack(event, map, selectedDate, callback);
        map.addLayer(newTrackDetails.track);
      }
    } else {
      // If no track element currenlty exists,
      // but there is a multiday event, build a new track
      newTrackDetails = createTrack(event, map, selectedDate, callback);
      map.addLayer(newTrackDetails.track);
      self.active = true;
    }
    self.trackDetails = newTrackDetails;
  };
  var debounceTrackUpdate = lodashDebounce((event, selectedDate, map, selectEventCallback) => {
    self.update(event, map, selectedDate, selectEventCallback);
  }, 1000);
  self.removeTrack = function(map, trackObj) {
    map.removeLayer(trackObj.track);
    naturalEventsRemoveOldPoints(map, trackObj.pointArray);
    return {};
  };
  init();
  return self;
}
var naturalEventsTrackLayer = function(featuresArray, styles) {
  return new OlLayerVector({
    source: new OlSourceVector({
      features: featuresArray
    }),
    extent: [-180, -90, 180, 90],
    style: function(feature) {
      return styles[feature.get('type')];
    }

  });
};
var naturalEventsTrackPoint = function(clusterPoint, isSelected, callback) {
  var overlayEl = document.createElement('div');
  var circleEl = document.createElement('div');
  var textEl = document.createElement('span');
  var properties = clusterPoint.properties;
  var content = document.createTextNode(properties.date);
  var date = properties.date;
  var eventID = properties.event_id;

  overlayEl.className = isSelected ? 'track-marker-case track-marker-case-selected' : 'track-marker-case';
  overlayEl.dataset.id = eventID;
  overlayEl.id = 'track-marker-case-' + date;
  overlayEl.onclick = function() {
    callback(eventID, date);
  };
  textEl.appendChild(content);
  textEl.className = 'track-marker-date';
  circleEl.className = 'track-marker track-marker-' + date;
  circleEl.id = 'track-marker-' + date;
  overlayEl.appendChild(circleEl);
  overlayEl.appendChild(textEl);

  return new OlOverlay({
    position: clusterPoint.geometry.coordinates,
    positioning: 'center-center',
    element: overlayEl,
    stopEvent: false
  });
};

var naturalEventsTrackLine = function(coordinateArray, type) {
  return new OlFeature({
    type: type,
    geometry: new OlGeomMultiLineString(coordinateArray)
  });
};
var naturalEventsTrackStyle = function() {
  return {
    'geoMarker': new OlStyleStyle({
      image: new OlStyleCircle({
        radius: 4,
        snapToPixel: false,
        fill: new OlStyleFill({ color: 'white' }),
        stroke: new OlStyleStroke({
          color: 'white',
          width: 2
        })
      })
    }),
    'white-line': new OlStyleStyle({
      stroke: new OlStyleStroke({
        color: 'white',
        width: 3
      })
    }),
    'black-line': new OlStyleStyle({
      stroke: new OlStyleStroke({
        color: 'black',
        width: 1
      })
    })
  };
};
var createTrack = function (eventObj, map, selectedDate, callback) {
  var olPointCoordinates = [];
  var eventTrackStyles;
  var olTrackLineFeatures = [];
  var pointObject = {};
  var geoJSONPointsBeforeSelected = [];
  var geoJSONPointsAfterSelected = [];
  var clustersBeforeSelected;
  var clustersAfterSelected;

  var selectedPoint;
  var zoom = map.getView().getZoom();
  var clusters;
  var afterSelected = false;
  lodashEach(eventObj.geometries, function (geometry, index) {
    var date = geometry.date.split('T')[0];
    var coordinates = geometry.coordinates;
    var isSelected = (selectedDate === date);

    olPointCoordinates.push(coordinates);
    // Cluster in three groups
    if (isSelected) {
      selectedPoint = naturalEventsPointToGeoJSON(eventObj.id, coordinates, date);
      afterSelected = true;
    } else if (!afterSelected) {
      geoJSONPointsBeforeSelected.push(naturalEventsPointToGeoJSON(eventObj.id, coordinates, date));
    } else {
      geoJSONPointsAfterSelected.push(naturalEventsPointToGeoJSON(eventObj.id, coordinates, date));
    }
  });
  clustersBeforeSelected = naturalEventsGetClusterPoints(firstClusterObj, geoJSONPointsBeforeSelected, zoom);
  clustersAfterSelected = naturalEventsGetClusterPoints(secondClusterObj, geoJSONPointsAfterSelected, zoom);
  clusters = clustersBeforeSelected.concat([selectedPoint], clustersAfterSelected);
  sortCluster(clusters);
  eventTrackStyles = naturalEventsTrackStyle();
  pointObject = addPoints(clusters, map, selectedDate, callback);

  olTrackLineFeatures.push(naturalEventsTrackLine(pointObject.trackArray, 'white-line'));
  olTrackLineFeatures.push(naturalEventsTrackLine(pointObject.trackArray, 'black-line'));

  return {
    'id': eventObj.id,
    'track': naturalEventsTrackLayer(olTrackLineFeatures, eventTrackStyles),
    'pointArray': pointObject.overlayArray,
    'selectedDate': selectedDate,
    'hidden': false
  };
};
var naturalEventsRemoveOldPoints = function (map, pointOverlayArray) {
  lodashEach(pointOverlayArray, function (pointOverlay) {
    map.removeOverlay(pointOverlay);
  });
};
var updateSelection = function (newDate) {
  var oldSelectedPoint = document.getElementsByClassName('track-marker-case-selected')[0];
  var newSelectedPoint = document.getElementById('track-marker-case-' + newDate);

  oldSelectedPoint.className = 'track-marker-case';
  newSelectedPoint.className = 'track-marker-case track-marker-case-selected';
};
var addPoints = function(clusters, map, selectedDate, callback) {
  var overlays = [];
  var trackArray = [];

  lodashEach(clusters, function(clusterPoint, index) {
    let point;
    let date = clusterPoint.properties.date || clusterPoint.properties.startDate;
    let isSelected = (selectedDate === date);
    let pointClusterObj = (new Date(date) > new Date(selectedDate)) ? firstClusterObj : secondClusterObj;
    if (index !== 0) {
      trackArray.push([clusters[index - 1].geometry.coordinates, clusterPoint.geometry.coordinates]);
    }
    if (clusterPoint.properties.cluster) {
      point = getClusterPointEl(clusterPoint, map, pointClusterObj, callback);
      overlays.push(point);
    } else {
      point = naturalEventsTrackPoint(clusterPoint, isSelected, callback);
      overlays.push(point);
    }
    map.addOverlay(point);
  });
  return { trackArray: trackArray, overlayArray: overlays };
};

function getClusterPointEl(cluster, map, pointClusterObj, callback) {
  var overlayEl = document.createElement('div');
  var circleEl = document.createElement('div');
  var innerCircleEl = document.createElement('div');

  var textEl = document.createElement('span');
  var properties = cluster.properties;
  var clusterId = properties.cluster_id;
  var number = properties.point_count_abbreviated;
  var numberEl = document.createTextNode(number);
  var dateRangeTextEl = document.createTextNode(properties.startDate + ' to ' + properties.endDate);
  var coordinates = cluster.geometry.coordinates;
  var sizeClass = (number < 3) ? 'small' : (number < 8) ? 'medium' : 'large';

  overlayEl.className = 'cluster-track-marker-case track-marker-case';
  textEl.className = 'cluster-track-marker-date track-marker-date';
  textEl.appendChild(dateRangeTextEl);
  circleEl.className = 'cluster-marker cluster-marker-' + sizeClass;
  innerCircleEl.className = 'cluster-marker-inner';
  innerCircleEl.appendChild(numberEl);
  circleEl.appendChild(innerCircleEl);
  circleEl.onclick = () => {
    var zoomTo = pointClusterObj.getClusterExpansionZoom(clusterId);
    var mapZoom = map.getView().getZoom();
    mapUtilZoomAction(map, zoomTo - mapZoom, 250, coordinates);
  };
  overlayEl.appendChild(circleEl);
  overlayEl.appendChild(textEl);

  return new OlOverlay({
    position: coordinates,
    positioning: 'center-center',
    element: overlayEl,
    stopEvent: false
  });
};
