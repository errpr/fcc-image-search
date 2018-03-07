require('dotenv').config();
const axios = require('axios');
const express = require('express');
let mongoClient = require("mongodb").MongoClient;
const dbUrl = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT}/fcc-errpr`;
const appUrl = "http://localhost:3000/";
let app = express();

function doTheSearchAndStoreResultAndRespondToRequest(collection, q, offset, response) {
  axios.all([getGoogResult(q), 
             getBingResult(q)])
    .then(axios.spread((googResult, bingResult) => {

      let results = conformResults(googResult, bingResult);
      persistResult(collection, q, results);

      if(q && offset) {
        response.json(results.slice(offset, offset+10));
      } else {
        response.json(results);
      }

    })).catch(err => console.log(err));
}

function getGoogResult(q) {
  let googParams = `key=${process.env.GSEARCH_API_KEY}&cx=${process.env.GSEARCH_CX}&q=${q}&searchType=image`;
  let googUrl = "https://www.googleapis.com/customsearch/v1?" + googParams;
  return axios.get(googUrl);
}

function getBingResult(q) {
  let bingParams = `q=${q}&responseFilter=Images,WebPages&safeSearch=Strict`;
  let bingUrl = "https://api.cognitive.microsoft.com/bing/v7.0/search?" + bingParams;
  return axios.get(bingUrl, { headers: { 'Ocp-Apim-Subscription-Key' : process.env.BING_API_KEY } });
}

function conformResults(googResult, bingResult) {
  let googConform = [];
  if(googResult.data.items) {
    googConform = googResult.data.items.map(e => {
      return {
        url: e.link,
        snippet: e.snippet,
        thumbnail: e.image.thumbnailLink,
        context: e.image.contextLink
      };
    });
  } else {
    console.log("No google results");
  }
  let bingConform = [];
  if(bingResult.data.images) {
    bingConform = bingResult.data.images.value.map(e => {
      return {
        url: e.contentUrl,
        snippet: e.name,
        thumbnail: e.thumbnailUrl,
        context: e.hostPageUrl
      };
    }); 
  } else {
    console.log("No bing results");
  }
  return interlaceTwoArrays(googConform, bingConform);
}

function interlaceTwoArrays(a, b) {
  let len = Math.max(a.length, b.length);
  result = [];
  for(i = 0; i < len; i++) {
    inner_r = [];
    if(i < a.length) {
      inner_r.push(a[i]);
    }
    if(i < b.length) {
      inner_r.push(b[i]);
    }
    result = result.concat(inner_r);
  }
  return result;
}

function getDbResult(collection, q) {
  return collection.findOne({"query" : q}).then(result => {
    //process db result
    if(result && result["results"]) {
      return {
        collection: collection,
        query: q,
        hasData: true,
        json: result["results"]
      }
    } else {
      return {
        collection: collection,
        query: q,
        hasData: false,
        json: []
      }
    }
  } );
}


function getDbResultWithOffset(collection, q, offset) {
  return collection.findOne({"query" : q}).then(result => {
    //process db result
    if(result && result["results"]) {
      return {
        collection: collection,
        query: q,
        hasData: hasData,
        json: result["results"].slice(offset, offset+10),
        offset: offset
      }
    } else {
      return {
        collection: collection,
        query: q,
        hasData: false,
        json: [],
        offset: offset
      }
    }
  } );
}

function persistResult(collection, q, results) {
  let data = {
    query: q,
    results: results
  };
  collection.insertOne(data);
}

app.get("/api/imagesearch/*", function (request, response) {
  let spaceTraceReplaceCase = (s) => { return s.trim().replace(/\s/g, "+")};
  let searchString = spaceTraceReplaceCase(request.params[0]);
  mongoClient.connect(dbUrl, (error, client) => {
    if(error) {
      throw error;
    }
    client.db('fcc-errpr').collection('image-search-recent').updateOne({query: searchString}, {$set:{"time":Date.now()}},{upsert:true});
    let collection = client.db('fcc-errpr').collection('image-search');
    if(request.query && request.query["offset"]) {
      getDbResultWithOffset(collection, searchString, parseFloat(request.query["offset"])).then(result => {
        if(result.hasData) {
          response.json(result.json);
        } else {
          doTheSearchAndStoreResultAndRespondToRequest(result.collection, result.query, result.offset, response);
        }
      }).catch(err => {console.log(err); response.status(503).send("Server error")});
    } else {
      getDbResult(collection, searchString).then(result => {
        if(result.hasData) {
          response.json(result.json);
        } else {
          doTheSearchAndStoreResultAndRespondToRequest(result.collection, result.query, null, response);
        }
      }).catch(err => {console.log(err); response.status(503).send("Server error")});
    }
  });
});

/*
app.get("/new/*", function (request, response) {
  if(!/^https?:\/\/.+\..+$/.test(request.params[0])) {
    response.status(400).send("Invalid URL");
  }

  mongoClient.connect(dbUrl, (error, client) => {
    if(error) {

      console.log("Database error: " + error);
      response.status(503).send("Internal Server Error");
      client.close();

    } else {

      let db = client.db('fcc-errpr');
      let urls = db.collection("urls");
      let urlsCounter = db.collection("urls-counter");

      urls.findOne({ "url" : request.params[0] }).then(result => {
        if(result) {

          response.json({
            "original_url" : result["url"],
            "short_url" : appUrl + result["short_url"]
          });
          client.close();

        } else {

          urlsCounter.findOneAndUpdate({"name":"urlCounter"}, {$inc:{"counterValue":1}}).then(result2 => {
            let counter = result2.value.counterValue;

            urls.insertOne({"url": request.params[0], "short_url": counter }).then(result3 => {
              response.json({"original_url": request.params[0], "short_url": appUrl + counter });
              client.close();
            });

          }).catch(err => client.close());
        }

      });
    }
  });
});

app.get("/:short", function (request, response) {
  mongoClient.connect(dbUrl, (error, client) => {

    if(error) {

      console.log("Database error: " + error);
      response.status(503).send("Internal Server Error");
      client.close();

    } else {

      let db = client.db('fcc-errpr');
      let urls = db.collection("urls");

      urls.findOne({ "short_url" : parseFloat(request.params.short) }).then(result => {

        if(result) {
          response.redirect(result["url"]);
        } else {
          response.status(404).send("Not Found");
        }
        client.close();

      }).catch(err => { 
        console.log(err); 
        response.status(503).send("Internal Server Error"); 
        client.close(); 
      });
    }
  });
});
*/

var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
