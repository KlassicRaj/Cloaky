const { z } = require("zod");
const { projectIdSchema } = require("./projectValidation");

const positiveIntegerQuery = z.string()
    .regex(/^\d+$/, "Value must be a positive integer")
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value > 0, "Value must be a positive integer");

const eventPaginationSchema = z.object({
    page: positiveIntegerQuery.optional().transform((value) => value ?? 1),
    pageSize: positiveIntegerQuery
        .refine((value) => value <= 100, "Page size must not exceed 100")
        .optional()
        .transform((value) => value ?? 50),
}).strict().superRefine(({ page, pageSize }, context) => {
    if ((page - 1) * pageSize > Number.MAX_SAFE_INTEGER) {
        context.addIssue({
            code: "custom",
            path: ["page"],
            message: "Page offset is outside the supported numeric range",
        });
    }
});

module.exports = { eventPaginationSchema, projectIdSchema };
