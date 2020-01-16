const express = require('express')
const app = express()
const bodyParser = require('body-parser')

const cors = require('cors')
const shortid = require('shortid');
const mongoose = require('mongoose')
mongoose.connect(process.env.DB)

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'mongodb connection error:'));
db.once('open', _ => {
    console.log("mongod db connected");
});

const ExerciseSchema = new mongoose.Schema({
    description: {
        type: String,
        required: true,
    },
    duration: {
        type: Number,
        required: true,
    },
    date: {
        type: Date,
        required: true,
        set: v => {
            var v = new Date(v);
            return new Date(v.getFullYear(), v.getMonth(), v.getDate());
        },
        get: v => v.toDateString(),
    },
});
ExerciseSchema.set('toJSON', { getters: true, virtuals: false });

const UserSchema = new mongoose.Schema({
    _id: {
        type: String,
        default: shortid.generate(),
    },
    username: {
        type: String,
        required: true,
        unique: true,
    },
    log: {
        type: [ExerciseSchema],
        select: false,
    },
    // hide default mongoose version key
    __v: {
        type: Number,
        select: false
    }
});


const User = mongoose.model('User', UserSchema);

app.use(cors())

app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())


app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

// new user
app.post('/api/exercise/new-user', async (req, res) => {
    const user = new User({
        username: req.body.username
    })
    try {
        const result = await user.save();
        return res.json({
            username: result.username,
            _id: result._id,
        })
    } catch (e) {
        if (e.code == 11000) {
            return res.send('username already taken');
        }
        return res.json(e);
    }
});

// get users list
app.get('/api/exercise/users', async (req, res) => {
    try {
        const users = await User.find();
        return res.json(users);
    } catch (e) {
        return res.json(e);
    }
});

// user add exercise
app.post('/api/exercise/add', async (req, res) => {
    try {
        const result = await User.findByIdAndUpdate(
            req.body.userId, {
                $push: {
                    log: {
                        description: req.body.description,
                        duration: req.body.duration,
                        date: req.body.date,
                    }
                }
            },
            {
                runValidators: true,
                new: true,
                select: {
                    _id: 1,
                    username: 1,
                    log: {
                        $slice: -1,
                    },
                },
            }
        );
        if (!result) {
            return res.status(422).send('unknown _id');
        }
        res.json({
            username: result.username,
            _id: result._id,
            description: result.log[0].description,
            duration: result.log[0].duration,
            date: result.log[0].date,
        })
    } catch (e) {
        res.status(422).set('content-type', 'text/plain').send(e.reason.message);
    }
});

// user search exercise in date range
app.get('/api/exercise/log', async (req, res) => {
    let user, filter, v;
    // validate request query params
    const required = 'userId';
    const optional = ['from', 'to', 'limit'];

    if (!Object.keys(req.query).includes(required)) {
        return res.status(422).send(`missing query param: ${required}`);
    }

    try {
        //user = User.findById(req.query.userId, "_id username log.description log.duration log.date");
        //
        var aggregation_pipelines = [
            {$match: {_id: req.query.userId}},
            {$project: { _id: 1, username: 1, log: 1}},
        ]

        if (req.query.from || req.query.to) {
            filter = {
                $filter: {
                    input: "$log",
                    as: "log_item",
                    cond: {
                    }
                }
            };
            if (req.query.from) {
                v = new Date(req.query.from);
                if (v == "Invalid Date") throw new Error(`Invalid "from" date string`);
                filter.$filter.cond["$gte"] = ["$$log_item.date", new Date(v.getFullYear(), v.getMonth(), v.getDate())];
            }

            if (req.query.to) {
                v = new Date(req.query.from);
                if (v == "Invalid Date") throw new Error(`Invalid "to" date string`);
                filter.$filter.cond["$lte"] = ["$$log_item.date", new Date(v.getFullYear(), v.getMonth(), v.getDate())];
            }
            aggregation_pipelines[1].$project.log = filter;
        }

        if (req.query.limit) {
            if (req.query.limit != parseInt(req.query.limit)) throw new Error(`Invalid "limit" input`);
            aggregation_pipelines.push({$limit: parseInt(req.query.limit)});
        }

        console.log(aggregation_pipelines);

        let result = await User.aggregate(aggregation_pipelines);

        console.log(result);
        if (!result.length){
            return res.send('no such userId');
        }
        return res.json(result[0]);
    } catch (e) {
        res.status(422).send(e.message);
    }
})

// Not found middleware
app.use((req, res, next) => {
  return next({status: 404, message: 'not found'})
})

// Error Handling middleware
app.use((err, req, res, next) => {
  let errCode, errMessage

  if (err.errors) {
    // mongoose validation error
    errCode = 400 // bad request
    const keys = Object.keys(err.errors)
    // report the first validation error
    errMessage = err.errors[keys[0]].message
  } else {
    // generic or custom error
    errCode = err.status || 500
    errMessage = err.message || 'Internal Server Error'
  }
  res.status(errCode).type('txt')
    .send(errMessage)
})

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})
