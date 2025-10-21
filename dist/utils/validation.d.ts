import { ValidationChain } from 'express-validator';
export declare const authValidation: {
    register: ValidationChain[];
    login: ValidationChain[];
};
export declare const listValidation: {
    create: ValidationChain[];
    update: ValidationChain[];
};
export declare const searchValidation: ValidationChain[];
export declare const paginationValidation: ValidationChain[];
export declare const idValidation: (paramName: string) => ValidationChain;
//# sourceMappingURL=validation.d.ts.map