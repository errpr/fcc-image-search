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
  let result = [];
  for(let i = 0; i < len; i++) {
    let inner_r = [];
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
        hasData: true,
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
  let spaceAndCaseReplaceTrace = (s) => { return s.trim().replace(/\s/g, "+").toLowerCase()};
  let searchString = spaceAndCaseReplaceTrace(request.params[0]);
  mongoClient.connect(dbUrl, (error, client) => {
    if(error) {
      console.log(error);
      response.status(503).send("Server error");
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

app.get("/api/latest/imagesearch/", function (request, response) {
  mongoClient.connect(dbUrl, (error, client) => {
    if(error) {
      console.log(error);
      response.status(503).send("Server error");
    }
    client.db('fcc-errpr')
          .collection('image-search-recent')
          .find({},{sort: "time", limit: 10})
          .project({query:1,time:1})
          .toArray()
          .then(a => {
      response.json(a.map(e => { 
        let o = {
          query: e["query"],
          time: new Date(e["time"]).toString()
        }
        return o;      
      }));
    });
  });
});

var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
