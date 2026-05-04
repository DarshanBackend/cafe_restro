import mongoose from "mongoose"


const themeCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Theme category name is required"],
        trim: true
    },
    image: {
        type: String,
        required: [true, "Theme category image is required"],
        trim: true
    },
    area: {
        type: String,
        enum: ["cafe", "restaurant"],
        required: [true, "Theme category area is required"],
        trim: true
    }
})

export default mongoose.model("ThemeCategory", themeCategorySchema);

