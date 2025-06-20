const express = require("express");
const cors = require("cors");
require("dotenv").config();

//token step 3
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_Service_Key, "base64").toString(
  "utf8"
);
// console.log(process.env.FB_Service_Key);
const serviceAccount = JSON.parse(decoded);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// midlware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.2rg7znb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  autoSelectFamily: false,
});

// token step 3

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// token step 2
const verifyFirebaseToken = async (req, res, next) => {
  // console.log("token", req.headers);
  const authHeader = req.headers?.authorization;
  // console.log(authHeader);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

//token step 4

const verifyTokenEmail = (req, res, next) => {
  if (req.query.email !== req.decoded.email) {
    return res.status(403).message({ message: "forbideen acces" });
  }
  next();
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)

    // await client.connect();

    const roomsCollection = client.db("HotelHub").collection("rooms");
    const bookingsCollection = client.db("HotelHub").collection("BookedRoom");

    // All Room Related APi
    //
    app.get("/rooms", async (req, res) => {
      const result = await roomsCollection.find().toArray();
      res.send(result);
    });

    app.get("/featured", async (req, res) => {
      try {
        const featuredRooms = await roomsCollection
          .find({ availability: true }) // only available rooms
          .sort({ rating: -1 }) // highest rating first
          .limit(6) // only top 6
          .toArray();

        res.send(featuredRooms);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch featured rooms" });
      }
    });

    app.get("/rooms/filter", async (req, res) => {
      try {
        const min = parseInt(req.query.min) || 0;
        const max = parseInt(req.query.max) || 1000000;

        const query = {
          price: { $gte: min, $lte: max },
        };

        const result = await roomsCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Filter failed" });
      }
    });

    app.get("/rooms/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const room = await roomsCollection.findOne(query);
      res.send(room);
    });

    // Get Reviews of a Room
    app.get("/rooms/:id/reviews", async (req, res) => {
      const id = req.params.id;
      const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
      res.send(room.reviews || []);
    });

    // Post a Review
    app.post("/rooms/:id/review", async (req, res) => {
      const roomId = req.params.id;
      const newReview = req.body;
      const { userEmail } = newReview;
      // console.log(newReview);

      // Step 1: Check if user has a booking for this room

      const bookingExists = await bookingsCollection.findOne({
        userEmail: userEmail,
        roomId: roomId,
      });
      // console.log(bookingExists);
      if (!bookingExists) {
        return res
          .status(403)
          .send({ message: "You cannot review this room without booking." });
      }

      // Step 3: Update room's review

      const filter = { _id: new ObjectId(roomId) };
      const update = { $push: { reviews: newReview } };

      const result = await roomsCollection.updateOne(filter, update);

      // after reviewing add avg ratings
      const updatedRoom = await roomsCollection.findOne(filter);
      const ratingsArray = updatedRoom.reviews.map((review) =>
        Number(review.rating)
      );

      //acc= sum , curr=current valu
      const averageRating =
        ratingsArray.reduce((acc, curr) => acc + curr, 0) / ratingsArray.length;

      const updateAvg = {
        $set: { rating: parseFloat(averageRating.toFixed(1)) },
      };

      const updateratingRooms = await roomsCollection.updateOne(
        filter,
        updateAvg
      );

      //  Update rating in bookings collection for that user and room

      const bookingFilter = { roomId: roomId, userEmail: userEmail };
      const updateratingBookedRoom = await bookingsCollection.updateOne(
        bookingFilter,
        updateAvg
      );

      // send it ui
      const avgRating = {
        rating: parseFloat(averageRating.toFixed(1)),
      };

      res.send({ result, avgRating });
    });

    // delte single reviews

    app.delete("/rooms/:id/review", async (req, res) => {
      const roomId = req.params.id;
      const { userEmail, timestamp } = req.body;
      console.log(userEmail, timestamp);

      if (!userEmail || !timestamp) {
        return res.status(400).send({ message: "Missing data" });
      }

      const filter = { _id: new ObjectId(roomId) };

      const update = {
        $pull: {
          reviews: {
            userEmail: userEmail,
            timestamp: timestamp,
          },
        },
      };

      const result = await roomsCollection.updateOne(filter, update);

      // Recalculate avg rating
      const updatedRoom = await roomsCollection.findOne(filter);
      const ratingsArray = updatedRoom.reviews.map((review) =>
        Number(review.rating)
      );
      const avgRating =
        ratingsArray.reduce((acc, cur) => acc + cur, 0) / ratingsArray.length ||
        0;

      await roomsCollection.updateOne(filter, {
        $set: { rating: parseFloat(avgRating.toFixed(1)) },
      });

      const updateRatings = { rating: parseFloat(avgRating.toFixed(1)) };

      res.send({ result, updateRatings });
    });

    // Room details page  related api

    //Create bookings seperate collection

    app.post("/bookings", async (req, res) => {
      const bookingInfo = req.body;
      // console.log(bookingInfo);
      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    });

    app.patch("/rooms/:id/availability", async (req, res) => {
      const roomId = req.params.id;
      const availability = req.body;

      // console.log("roomId", roomId, "avaiblity", availability);

      const query = { _id: new ObjectId(roomId) };
      const update = { $set: availability };

      const result = await roomsCollection.updateOne(query, update);
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const bookId = req.params.id;

      const result = await bookingsCollection.deleteOne({ roomId: bookId });

      // update rooms availablity

      const query = { _id: new ObjectId(bookId) };
      const update = { $set: { availability: true } };
      const updateAvailablity = await roomsCollection.updateOne(query, update);
      res.send({ result, updateAvailablity });
    });

    // Get bookings by user email
    app.get(
      "/my-bookings",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        // if (email !== req.decoded.email) {
        //   return res.status(403).message({ message: "forbideen acces" });
        // }

        try {
          const bookings = await bookingsCollection
            .find({ userEmail: email })
            .toArray();

          res.send(bookings);
        } catch (error) {
          res.status(500).send({ error: "Failed to fetch bookings" });
        }
      }
    );

    app.patch("/bookings/:roomId", async (req, res) => {
      const { roomId } = req.params;
      const { newDate, email } = req.body;

      const result = await bookingsCollection.updateOne(
        { roomId, userEmail: email },
        { $set: { bookingDate: newDate } }
      );

      res.send(result);
    });

    // home related ApI

    app.get("/home-reviews", async (req, res) => {
      try {
        const rooms = await roomsCollection.find().toArray();

        const allReviews = [];

        rooms.forEach((room) => {
          room.reviews.forEach((review) => {
            allReviews.push({
              ...review,
            });
          });
        });

        // Sort reviews by latest timestamp (descending)
        const sortedReviews = allReviews.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );

        // Optional: send only top 6
        const latestReviews = sortedReviews.slice(0, 15);

        res.send(latestReviews);
      } catch (err) {
        res.status(500).send({ error: "Failed to load reviews." });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello HotelHub!");
});

app.listen(port, () => {
  console.log(` HotelHub running on ${port}`);
});
