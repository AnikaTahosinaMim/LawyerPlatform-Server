const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dotenv.config();
const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

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
    // await client.connect();
    const db = client.db("LawyerPlatform");
    const lawyerData = db.collection("lawyerData");
    const hiringCollection = db.collection("hirings");
    const userCollection = db.collection("user");

    // user profile update
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;

      const result = await userCollection.findOne({ email });

      res.send(result);
    });
    app.patch("/user/:email", async (req, res) => {
      const email = req.params.email;

      const { name, image } = req.body;

      const result = await userCollection.updateOne(
        { email },
        {
          $set: {
            name,
            image,
          },
        },
      );

      res.send(result);
    });

    // lawyer profile
    app.get("/lawyer/:email", async (req, res) => {
      const email = req.params.email;

      const result = await lawyerData.findOne({ email });

      res.send(result);
    });
    const { ObjectId } = require("mongodb");

    app.patch("/lawyer/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;

        console.log("id:", id);
        console.log("data:", data);

        // 🔥 REMOVE _id (MAIN FIX)
        const { _id, ...rest } = data;

        const result = await lawyerData.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: rest,
          },
        );

        console.log(result, "result");

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Update failed", error });
      }
    });

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
    app.get("/analytics", async (req, res) => {
      const totalUsers = await userCollection.countDocuments({
        role: "user",
      });

      const totalLawyers = await userCollection.countDocuments({
        role: "lawyer",
      });

      const totalHires = await hiringCollection.countDocuments();

      const paidHires = await hiringCollection
        .find({ paymentStatus: "paid" })
        .toArray();

      const totalRevenue = paidHires.reduce(
        (sum, item) => sum + item.consultationFee,
        0,
      );

      res.send({
        totalUsers,
        totalLawyers,
        totalHires,
        totalRevenue,
      });
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

          success_url: `https://lawyerplatformclient.vercel.app/payment-success?hiringId=${hiring._id}`,
          cancel_url: `https://lawyerplatformclient.vercel.app/dashboard/user/my-hiring`,
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
    app.get("/transactions", async (req, res) => {
      const result = await hiringCollection
        .find({ paymentStatus: "paid" })
        .toArray();

      res.send(result);
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
      const { search, specialization } = req.query;
      const limit = parseInt(req.query.limit);

      let query = {};

      if (search) {
        query.name = {
          $regex: search,
          $options: "i",
        };
      }

      if (specialization) {
        query.specialization = specialization;
      }

      let cursor = lawyerData.find(query);

      if (limit) {
        cursor = cursor.limit(limit);
      }

      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/top-lawyers", async (req, res) => {
      try {
        const hires = await hiringCollection.find().toArray();

        const hireCount = {};

        hires.forEach((hire) => {
          if (!hire.lawyerEmail) return;

          hireCount[hire.lawyerEmail] = (hireCount[hire.lawyerEmail] || 0) + 1;
        });

        const lawyers = await lawyerData.find().toArray();

        const topLawyers = lawyers
          .map((lawyer) => ({
            ...lawyer,
            hires: hireCount[lawyer.email] || 0,
          }))
          .sort((a, b) => b.hires - a.hires)
          .slice(0, 3);

        res.send(topLawyers);
      } catch (error) {
        console.log(error);
        res.status(500).send({
          message: "Something went wrong",
        });
      }
    });

    // details pages
    app.get("/lawyerData/:id", async (req, res) => {
      const id = req.params.id;
      const result = await lawyerData.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // hirings
    // hirings
    app.post("/hirings", async (req, res) => {
      try {
        console.log("========== HIRING API HIT ==========");
        console.log("Request Body:", req.body);

        const hiringData = req.body;

        if (!hiringData.lawyerId || !hiringData.userEmail) {
          return res.status(400).send({
            message: "Missing required fields.",
          });
        }

        const exists = await hiringCollection.findOne({
          lawyerId: hiringData.lawyerId,
          userEmail: hiringData.userEmail,
          status: "pending",
        });

        console.log("Existing Hiring:", exists);

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

        console.log("Insert Result:", result);

        res.send(result);
      } catch (error) {
        console.error("HIRING ERROR:", error);

        res.status(500).send({
          message: "Internal Server Error",
          error: error.message,
        });
      }
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

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!",
    // );
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
// module.exports=app
