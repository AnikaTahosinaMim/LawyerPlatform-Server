const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose");
dotenv.config();
const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);
const verifyToken = async (req, res, next) => {
  const authHeaders = req.headers.authorization;
  if (!authHeaders || !authHeaders.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  const token = authHeaders.split(" ")[1];
  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  // console.log(token, "tokenssssss");
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    // console.log(payload, "payload heresssssss");
    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

const verifySellerPro = async (req, res, next) => {
  const user = req.user;
  console.log(user, "user from seller");
  if (user.role !== "user" || user.plan !== "pro") {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  next();
};

async function run() {
  try {
    await client.connect();
    const db = client.db("LawyerPlatform");
    const lawyerData = db.collection("lawyerData");
    const hiringCollection = db.collection("hirings");
    const userCollection = db.collection("user");

    // dashoboard
    app.get("/user", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    app.patch("/user/role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { role },
        },
      );

      res.send(result);
    });
    app.delete("/user/:id", async (req, res) => {
      const id = req.params.id;

      const result = await userCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // payment
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const hiring = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",

          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: hiring.consultationFee * 100,
                product_data: {
                  name: `Consultation with ${hiring.lawyerName}`,
                },
                unit_amount: hiring.consultationFee * 100, // Stripe amount in paisa
              },
              quantity: 1,
            },
          ],

          success_url: `http://localhost:3000/payment-success?hiringId=${hiring._id}`,
          cancel_url: `http://localhost:3000/dashboard/user/my-hiring`,
        });

        res.send({
          url: session.url,
        });
      } catch (error) {
        console.log(error);
        res.status(500).send({
          message: error.message,
        });
      }
    });
    app.patch("/hirings/payment/:id", async (req, res) => {
      const id = req.params.id;

      const result = await hiringCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            paymentStatus: "paid",
          },
        },
      );

      res.send(result);
    });
    app.get("/lawyerData", async (req, res) => {
      const limit = parseInt(req.query.limit);

      let query = lawyerData.find();

      if (limit) {
        query = query.limit(limit);
      }
      const result = await query.toArray();
      res.send(result);
    });

    // details pages
    app.get("/lawyerData/:id", async (req, res) => {
      const id = req.params.id;
      const result = await lawyerData.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // hirings
    app.post("/hirings", async (req, res) => {
      const hiringData = req.body;
      const exists = await hiringCollection.findOne({
        lawyerId: hiringData.lawyerId,
        userEmail: hiringData.userEmail,
        status: "pending",
      });

      if (exists) {
        return res.status(400).send({
          message: "You have already sent a hiring request.",
        });
      }

      const result = await hiringCollection.insertOne({
        ...hiringData,
        status: "pending",
        paymentStatus: "unpaid",
        createdAt: new Date(),
      });

      res.send(result);
    });
    app.get("/hirings/user/:email", async (req, res) => {
      const email = req.params.email;

      const result = await hiringCollection
        .find({ userEmail: email })
        .toArray();

      res.send(result);
    });

    // lawyer dashboard
    app.get("/hirings/lawyer/:email", async (req, res) => {
      const email = req.params.email;

      const result = await hiringCollection
        .find({ lawyerEmail: email })
        .toArray();

      res.send(result);
    });
    app.patch("/hirings/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const result = await hiringCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
          },
        },
      );

      res.send(result);
    });
    // payment

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
