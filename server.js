require('dotenv').config();
var express = require('express');
var mongoClient = require("mongodb").MongoClient;
const dbUrl = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT}/fcc-errpr`;
const appUrl = "http://localhost:3000/";
var app = express();

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

var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
