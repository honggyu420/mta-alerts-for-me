var express = require('express');
var GtfsRealtimeBindings = require('gtfs-realtime-bindings');
var request = require('request');
var path = require('path'),
cookieParser = require('cookie-parser'),
bodyParser = require('body-parser'),
fs = require('fs'),
request = require('request'),
querystring = require('querystring');
config = require('./config/config')

const mta_key = config.mta_key
const my_number = config.my_number
const twilio_number = config.twilio_number
const twilio_sid = config.twilio_sid
const twilio_auth_token = config.twilio_auth_token

const client = require('twilio')(twilio_sid, twilio_auth_token);
var app = express();

//for debugging
app.listen(8000, function() {
    console.log("server online on port 8000");
});
let allowCrossDomain = function(req, res, next) {
  res.header('Access-Control-Allow-Origin', "*");
  res.header('Access-Control-Allow-Headers', "*");
  next();
}
app.use(allowCrossDomain);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

var epochToHHMM = function(epoch) {
    let now = new Date(epoch*1000);
    let is_pm = false
    let hrs = now.getHours();
    if (hrs > 12) {
        hrs -= 12
        is_pm = true
    }
    const mins = now.getMinutes();
    let hhmm = hrs + ":" + (mins < 10 ? "0" + mins : mins) + (is_pm? ' PM' : ' AM');

    return hhmm
}

var formatMessage = function(data) {
    let message = "\nDEPARTURES:\n"
    kingston_count = 0;
    nostrand_count = 0;
    for (let departure of data) {
        let time = epochToHHMM(departure.arrival_time)
        if (departure.stop === 'kingston' && kingston_count != 3 && departure.minutes_left > 5) {
            message += `• Kingston (C) in ${departure.minutes_left} minutes at ${time}\n`
            kingston_count += 1
        } else if (departure.stop === 'nostrand' && nostrand_count != 3 && departure.minutes_left > 5) {
            message += `• Nostrand (A) in ${departure.minutes_left} minutes at ${time}\n`
            nostrand_count += 1
        }
    }

    return message
}

var getKingstonNostrandStopTimes = function(feed) {
  let data = [];
  let now = Math.floor(new Date().getTime()/1000.0);
  let kingston_stops = ["A47N"]
  let nostrand_stops = ["A46N"]
  feed.entity.forEach(entity => {
    if (entity.tripUpdate) {
        entity.tripUpdate.stopTimeUpdate.forEach(time => {
            let arrival_time = time.arrival.time.low
            let seconds_left = arrival_time - now
            let minutes_left = Math.floor(seconds_left/60)
            if (minutes_left > 0) {
                let route = entity.tripUpdate.trip.routeId
                let datum = {route, arrival_time, minutes_left}
                if (kingston_stops.indexOf(time.stopId) > -1) {
                    datum.stop = "kingston"
                    data.push(datum)
                } else if (nostrand_stops.indexOf(time.stopId) > -1) {
                    datum.stop = "nostrand"
                    data.push(datum)
                }
            }
        })
    }
  })
  data.sort((a,b) => {
      if(a.minutes_left > b.minutes_left) {
          return 1
      } else {
          return -1
      }
  })

  return data
}

var getNextDepartures = function(req, res, next) {
    var requestSettings = {
      method: 'GET',
      url: `http://datamine.mta.info/mta_esi.php?key=${mta_key}&feed_id=26`,
      encoding: null
    };

    request(requestSettings, function (error, response, body) {
      if (error || response.statusCode != 200) {
        res.error("something bad happened while acquiring feed data")
      } else {
        // decode feed
        let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(body);

        // acquire relevant data
        let data = getKingstonNostrandStopTimes(feed)

        // format data as text massage
        let message = formatMessage(data);

        // send using twilio client
        client.messages.create({
          to: my_number,
          from: twilio_number,
          body: message
        }).then(message => {
          res.send(data);
        }).catch(error => {
          next(error)
        })
      }
    });
}

app.get('/me', getNextDepartures);
