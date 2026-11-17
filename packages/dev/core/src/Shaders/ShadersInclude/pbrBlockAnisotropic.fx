#ifdef ANISOTROPIC
    struct anisotropicOutParams
    {
        float anisotropy;
        vec3 anisotropicTangent;
        vec3 anisotropicBitangent;
        vec3 anisotropicNormal;
    #if DEBUGMODE > 0 && defined(ANISOTROPIC_TEXTURE)
        vec3 anisotropyMapData;
    #endif
    };

    #define pbr_inline
    anisotropicOutParams anisotropicBlock(
        in vec3 vAnisotropy,
        in float roughness,
    #ifdef ANISOTROPIC_TEXTURE
        in vec3 anisotropyMapData,
    #endif
        in mat3 TBN,
        in vec3 normalW,
        in vec3 viewDirectionW
    )
    {
        anisotropicOutParams outParams;
        float anisotropy = clamp(vAnisotropy.b, -1.0, 1.0);
        vec2 anisotropyDirection = vAnisotropy.xy;
        float anisotropyDirectionLengthSquared = dot(anisotropyDirection, anisotropyDirection);
        anisotropyDirection = anisotropyDirectionLengthSquared > 1e-8 ? anisotropyDirection * inversesqrt(anisotropyDirectionLengthSquared) : vec2(1.0, 0.0);

        #ifdef ANISOTROPIC_TEXTURE
            anisotropy = clamp(anisotropy * anisotropyMapData.b, -1.0, 1.0);

            #if DEBUGMODE > 0
                outParams.anisotropyMapData = anisotropyMapData;
            #endif

            vec2 anisotropyMapDirection = anisotropyMapData.rg * 2.0 - 1.0;
            float anisotropyMapDirectionLengthSquared = dot(anisotropyMapDirection, anisotropyMapDirection);
            anisotropyMapDirection = anisotropyMapDirectionLengthSquared > 1e-8 ? anisotropyMapDirection * inversesqrt(anisotropyMapDirectionLengthSquared) : anisotropyDirection;

            #ifdef ANISOTROPIC_LEGACY
                anisotropyDirection *= anisotropyMapDirection;
            #else
                anisotropyDirection = mat2(anisotropyDirection.x, anisotropyDirection.y, -anisotropyDirection.y, anisotropyDirection.x) * anisotropyMapDirection;
            #endif
        #endif

        mat3 anisoTBN = mat3(normalize(TBN[0]), normalize(TBN[1]), normalize(TBN[2]));
        anisotropyDirectionLengthSquared = dot(anisotropyDirection, anisotropyDirection);
        anisotropyDirection = anisotropyDirectionLengthSquared > 1e-8 ? anisotropyDirection * inversesqrt(anisotropyDirectionLengthSquared) : vec2(1.0, 0.0);
        vec3 anisotropicTangent = normalize(anisoTBN * vec3(anisotropyDirection, 0.));
        vec3 anisotropicBitangent = normalize(cross(anisoTBN[2], anisotropicTangent));
        
        outParams.anisotropy = anisotropy;
        outParams.anisotropicTangent = anisotropicTangent;
        outParams.anisotropicBitangent = anisotropicBitangent;
        outParams.anisotropicNormal = getAnisotropicBentNormals(anisotropicTangent, anisotropicBitangent, normalW, viewDirectionW, anisotropy, roughness);
        return outParams;
    }
#endif
