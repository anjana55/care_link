-- Rename, don't convert: existing values were recorded in centimetres and are
-- deliberately left untouched, so they are reinterpreted as inches. The scale
-- change to DECIMAL(5,1) is what lets a one-decimal-inch entry be stored at
-- all; CHANGE preserves the rows where a DROP + ADD pair would have emptied the
-- column. Hand-written because drizzle-kit's generator asks how to resolve the
-- dropped/added column pair interactively, which it cannot do without a TTY.
ALTER TABLE `caregivers` CHANGE `height_cm` `height_in` DECIMAL(5,1);
